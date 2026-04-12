"use client";

import { useState, useCallback } from "react";
import { ResourceModal } from "@/components/shared/ResourceModal";
import { DocumentViewer } from "./DocumentViewer";
import { DocumentEditor } from "./DocumentEditor";
import type { TacticCategory } from "@prisma/client";
import type { EffectiveGnome } from "@/services/gnome.service";

type Mode = "view" | "edit" | "create";

interface GnomeModalProps {
  projectSlug: string;
  gnome?: EffectiveGnome | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const TACTIC_CATEGORIES: TacticCategory[] = [
  "SOCIAL_MEDIA", "COMMUNITY", "STORE_PRESENCE", "CONTENT_MARKETING",
  "PAID_ADS", "PARTNERSHIPS", "SEO", "EMAIL", "EVENTS", "OTHER",
];

const TOOL_PROVIDER_OPTIONS = [
  "twitter", "instagram", "youtube", "tiktok", "steam", "app_store",
  "google_analytics", "plausible", "discord", "reddit", "email",
  "web_search", "content_generation", "data_analysis",
];

export function GnomeModal({
  projectSlug,
  gnome,
  onClose,
  onSaved,
  onDeleted,
}: GnomeModalProps) {
  const isCreate = !gnome;
  const [mode, setMode] = useState<Mode>(isCreate ? "create" : "view");

  // State
  const [name, setName] = useState(gnome?.name || "");
  const [description, setDescription] = useState(gnome?.description || "");
  const [icon, setIcon] = useState(gnome?.icon || "/gnome_general.png");
  const [categories, setCategories] = useState<TacticCategory[]>(gnome?.categories || []);
  const [defaultModel, setDefaultModel] = useState(gnome?.defaultModel || "claude-sonnet-4-20250514");
  const [maxPlanTokens, setMaxPlanTokens] = useState(gnome?.maxPlanTokens ?? 2048);
  const [maxExecuteTokens, setMaxExecuteTokens] = useState(gnome?.maxExecuteTokens ?? 4096);
  const [canAutoExecute, setCanAutoExecute] = useState(gnome?.canAutoExecute ?? false);
  const [systemPromptTemplate, setSystemPromptTemplate] = useState(gnome?.systemPromptTemplate || "");
  const [toolProviders, setToolProviders] = useState<string[]>(gnome?.toolProviders || []);
  const [producibleWorkProducts, setProducibleWorkProducts] = useState<string[]>(gnome?.producibleWorkProducts || []);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty =
    name !== (gnome?.name || "") ||
    description !== (gnome?.description || "") ||
    icon !== (gnome?.icon || "/gnome_general.png") ||
    JSON.stringify(categories) !== JSON.stringify(gnome?.categories || []) ||
    defaultModel !== (gnome?.defaultModel || "claude-sonnet-4-20250514") ||
    maxPlanTokens !== (gnome?.maxPlanTokens ?? 2048) ||
    maxExecuteTokens !== (gnome?.maxExecuteTokens ?? 4096) ||
    canAutoExecute !== (gnome?.canAutoExecute ?? false) ||
    systemPromptTemplate !== (gnome?.systemPromptTemplate || "") ||
    JSON.stringify(toolProviders) !== JSON.stringify(gnome?.toolProviders || []) ||
    JSON.stringify(producibleWorkProducts) !== JSON.stringify(gnome?.producibleWorkProducts || []);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (categories.length === 0) {
      setError("At least one category is required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        description,
        icon,
        categories,
        defaultModel,
        maxPlanTokens,
        maxExecuteTokens,
        canAutoExecute,
        systemPromptTemplate,
        toolProviders,
        producibleWorkProducts,
      };

      if (isCreate) {
        const res = await fetch(`/api/projects/${projectSlug}/gnomes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(`/api/projects/${projectSlug}/gnomes/${gnome.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!gnome || gnome.isVirtual) return;
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectSlug}/gnomes/${gnome.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleReset = async () => {
    if (!gnome || gnome.isVirtual || !gnome.builtInSlug) return;
    if (!window.confirm("Reset this gnome to its default configuration?")) return;

    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectSlug}/gnomes/${gnome.id}/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    }
  };

  const isEditing = mode === "edit" || mode === "create";

  const toggleCategory = (cat: TacticCategory) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const toggleTool = (tool: string) => {
    setToolProviders((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );
  };

  return (
    <ResourceModal
      title={isCreate ? "New Gnome" : name}
      subtitle={gnome?.isVirtual ? "Built-in" : gnome?.isBuiltIn ? "Customized" : undefined}
      version={gnome?.version}
      mode={mode}
      onModeChange={setMode}
      onClose={onClose}
      onSave={handleSave}
      onDelete={gnome && !gnome.isVirtual ? handleDelete : undefined}
      isSaving={isSaving}
      isDirty={isDirty}
      error={error}
      createLabel="Create Gnome"
      deleteLabel="Delete gnome"
      contentArea={
        isEditing ? (
          <div className="space-y-6">
            {/* Config fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Model</label>
                <select
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                >
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                  <option value="claude-opus-4-20250514">Claude Opus 4</option>
                  <option value="claude-haiku-4-20250506">Claude Haiku 4</option>
                </select>
              </div>
              <div className="flex items-end gap-4">
                <span className="text-xs opacity-60">Auto-execute: Disabled</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Plan Tokens</label>
                <input
                  type="number"
                  value={maxPlanTokens}
                  onChange={(e) => setMaxPlanTokens(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Execute Tokens</label>
                <input
                  type="number"
                  value={maxExecuteTokens}
                  onChange={(e) => setMaxExecuteTokens(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                />
              </div>
            </div>

            {/* System prompt template */}
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">System Prompt Template</label>
              <p className="text-[10px] opacity-50 mb-2">
                Uses Handlebars syntax. Available: {"{{project.name}}"}, {"{{tactic.name}}"}, {"{{task.title}}"}, {"{{metricsSection}}"}, {"{{toolsSection}}"}, {"{{knowledgeBlock}}"}, {"{{workProductSection}}"}
              </p>
              <DocumentEditor
                value={systemPromptTemplate}
                onChange={setSystemPromptTemplate}
                format="MARKDOWN"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Config summary */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-widest opacity-60">Model</span>
                <p className="text-sm mt-0.5 opacity-70">{defaultModel.replace("claude-", "").replace(/-\d+$/, "")}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest opacity-60">Plan / Execute Tokens</span>
                <p className="text-sm mt-0.5 opacity-70">{maxPlanTokens} / {maxExecuteTokens}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest opacity-60">Auto-execute</span>
                <p className="text-sm mt-0.5 opacity-70">{canAutoExecute ? "Yes" : "No"}</p>
              </div>
            </div>

            {/* System prompt template (read-only) */}
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-60 block mb-2">System Prompt Template</span>
              <DocumentViewer
                content={systemPromptTemplate}
                format="MARKDOWN"
              />
            </div>
          </div>
        )
      }
      metadataSidebar={
        isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                placeholder="My Custom Gnome"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Icon</label>
              <div className="flex items-center gap-3">
                {icon.startsWith("/") ? (
                  <img src={icon} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <span className="text-2xl w-10 h-10 flex items-center justify-center">{icon}</span>
                )}
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                  placeholder="/gnome_general.png or emoji"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50 resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Categories</label>
              <div className="flex flex-wrap gap-1.5">
                {TACTIC_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`text-[9px] uppercase tracking-widest px-2 py-1 rounded transition-colors ${
                      categories.includes(cat)
                        ? "bg-[#22c55e]/20 text-[#22c55e]"
                        : "bg-white/5 opacity-60 hover:opacity-80"
                    }`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Tool Providers</label>
              <div className="flex flex-wrap gap-1.5">
                {TOOL_PROVIDER_OPTIONS.map((tool) => (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className={`text-[9px] px-2 py-1 rounded transition-colors ${
                      toolProviders.includes(tool)
                        ? "bg-[#22c55e]/20 text-[#22c55e]"
                        : "bg-white/5 opacity-60 hover:opacity-80"
                    }`}
                  >
                    {tool.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest opacity-60 block mb-1">Work Products</label>
              <input
                type="text"
                value={producibleWorkProducts.join(", ")}
                onChange={(e) => setProducibleWorkProducts(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]/50"
                placeholder="e.g. linkedin-post, tweet-thread"
              />
              <p className="text-[9px] opacity-50 mt-1">Comma-separated slugs</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              {icon.startsWith("/") ? (
                <img src={icon} alt={name} className="w-12 h-12 rounded-lg object-cover" />
              ) : (
                <span className="text-3xl">{icon}</span>
              )}
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-60">Description</span>
              <p className="text-xs mt-0.5 opacity-70">{description}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-60">Categories</span>
              <div className="flex gap-1.5 flex-wrap mt-1">
                {categories.map((cat) => (
                  <span
                    key={cat}
                    className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded bg-[#22c55e]/10 text-[#22c55e]"
                  >
                    {cat.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest opacity-60">Tool Providers</span>
              <div className="flex gap-1.5 flex-wrap mt-1">
                {toolProviders.map((tool) => (
                  <span
                    key={tool}
                    className="text-[9px] px-2 py-0.5 rounded bg-white/5 opacity-80"
                  >
                    {tool.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
            {producibleWorkProducts.length > 0 && (
              <div>
                <span className="text-[10px] uppercase tracking-widest opacity-60">Work Products</span>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {producibleWorkProducts.map((wp) => (
                    <span key={wp} className="text-[9px] px-2 py-0.5 rounded bg-white/5 opacity-80">{wp}</span>
                  ))}
                </div>
              </div>
            )}
            {gnome?.isBuiltIn && !gnome.isVirtual && (
              <div className="pt-2">
                <button
                  onClick={handleReset}
                  className="text-[10px] uppercase tracking-widest text-amber-400/60 hover:text-amber-400 transition-colors"
                >
                  Reset to default
                </button>
              </div>
            )}
          </div>
        )
      }
    />
  );
}
