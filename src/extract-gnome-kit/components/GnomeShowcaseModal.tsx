"use client";

import type { EffectiveGnome } from "@/services/gnome.service";

/* ── Helpers ── */

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "34, 197, 94";
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeCategory(cat: string): string {
  return cat.replace(/_/g, " ");
}

function humanizeToolProvider(tp: string): string {
  const labels: Record<string, string> = {
    twitter: "Twitter / X",
    instagram: "Instagram",
    youtube: "YouTube",
    tiktok: "TikTok",
    discord: "Discord",
    reddit: "Reddit",
    steam: "Steam",
    app_store: "App Store",
    google_analytics: "Google Analytics",
    plausible: "Plausible",
    email: "Email",
    content_generation: "Content Generation",
    media_library: "Media Library",
    web_search: "Web Search",
    data_analysis: "Data Analysis",
    ai_image_generation: "AI Image Generation",
  };
  return labels[tp] ?? humanizeSlug(tp);
}

/* ── Showcase content per built-in gnome ── */

const SHOWCASE_DATA: Record<
  string,
  { tagline: string; whatTheyDo: string; whatTheyProduce: string[] }
> = {
  "social-media-gnome": {
    tagline: "Your voice across every platform",
    whatTheyDo:
      "Crafts engaging social media content, monitors how posts perform, spots trending conversations to join, and keeps your brand voice consistent across Twitter, Instagram, YouTube, and TikTok.",
    whatTheyProduce: ["LinkedIn posts", "Social media content"],
  },
  "community-gnome": {
    tagline: "Building spaces where fans become advocates",
    whatTheyDo:
      "Keeps a pulse on your Discord and Reddit communities, drafts dev logs and announcements, identifies your most active members, and suggests events or initiatives to keep engagement high.",
    whatTheyProduce: ["Community announcements", "Dev logs", "Engagement reports"],
  },
  "store-presence-gnome": {
    tagline: "Making your storefront work harder",
    whatTheyDo:
      "Tracks Steam wishlists, App Store downloads, and review sentiment. Analyzes competitor listings to find positioning opportunities and drafts optimized store page copy.",
    whatTheyProduce: ["Store page copy", "Competitive analysis"],
  },
  "content-marketing-gnome": {
    tagline: "Words that drive discovery and growth",
    whatTheyDo:
      "Researches keywords and trending topics, drafts blog posts and email campaigns, analyzes traffic patterns, and refines your content strategy based on what actually converts.",
    whatTheyProduce: ["Blog posts", "Email campaigns", "SEO briefs"],
  },
  "general-gnome": {
    tagline: "The versatile strategist for everything else",
    whatTheyDo:
      "Handles promotional tactics that don't fit neatly into one specialty — paid advertising, partnership outreach, event planning, and more. Researches opportunities and recommends action plans.",
    whatTheyProduce: ["Strategy briefs", "Action plans"],
  },
  "loan-processing-gnome": {
    tagline: "Methodical analysis, clear recommendations",
    whatTheyDo:
      "Walks through loan applications step by step — collecting documents, verifying income, assessing creditworthiness, and producing a structured decision summary for human review.",
    whatTheyProduce: ["Loan decision summaries", "Document checklists"],
  },
  "designer-gnome": {
    tagline: "Bringing your brand to life visually",
    whatTheyDo:
      "Generates visual assets from design briefs using AI image generation, then deposits them into the project media library for your review. Works alongside other gnomes who need imagery for their content.",
    whatTheyProduce: ["Social media graphics", "Marketing visuals", "Brand assets"],
  },
  "research-gnome": {
    tagline: "Finding signals before they become noise",
    whatTheyDo:
      "Scans the web, forums, and communities for trending topics and emerging conversations relevant to your project. Produces structured trend briefs that identify opportunities you can act on before competitors notice.",
    whatTheyProduce: ["Trend briefs", "Opportunity reports"],
  },
};

/* ── Component ── */

interface GnomeShowcaseModalProps {
  gnomes: EffectiveGnome[];
  projectColor: string;
  onClose: () => void;
}

export function GnomeShowcaseModal({
  gnomes,
  projectColor,
  onClose,
}: GnomeShowcaseModalProps) {
  const rgb = hexToRgb(projectColor);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-6xl mx-4 my-8 rounded-xl bg-[#0c0f0a] border border-white/10 shadow-2xl animate-grow-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-lg font-semibold">Meet the Gnomes</h2>
            <p className="text-xs opacity-60 mt-0.5">
              Your roster of specialized AI agents — each with unique skills and focus areas
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-lg flex-shrink-0"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[calc(100vh-160px)] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {gnomes.map((gnome) => {
              const showcase = SHOWCASE_DATA[gnome.slug];
              const tagline = showcase?.tagline;
              const whatTheyDo = showcase?.whatTheyDo ?? gnome.description;
              const whatTheyProduce =
                showcase?.whatTheyProduce ??
                (gnome.producibleWorkProducts.length > 0
                  ? gnome.producibleWorkProducts.map(humanizeSlug)
                  : null);

              return (
                <div
                  key={gnome.id}
                  className="rounded-xl bg-white/[0.03] border border-white/5 overflow-hidden"
                >
                  {/* Image */}
                  {gnome.icon && gnome.icon.startsWith("/") ? (
                    <div className="relative h-48 w-full bg-white/[0.02]">
                      <img
                        src={gnome.icon}
                        alt={gnome.name}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0c0f0a] via-transparent to-transparent" />
                    </div>
                  ) : (
                    <div className="h-48 w-full bg-white/[0.02] flex items-center justify-center">
                      <span className="text-6xl">{gnome.icon || "🤖"}</span>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-5 space-y-3">
                    {/* Name + tagline */}
                    <div>
                      <h3 className="text-base font-semibold">{gnome.name}</h3>
                      {tagline && (
                        <p
                          className="text-xs italic mt-0.5"
                          style={{ color: projectColor }}
                        >
                          {tagline}
                        </p>
                      )}
                    </div>

                    {/* What they do */}
                    <p className="text-xs leading-relaxed opacity-80">
                      {whatTheyDo}
                    </p>

                    {/* What they produce */}
                    {whatTheyProduce && whatTheyProduce.length > 0 && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest opacity-50 mb-1.5">
                          Produces
                        </p>
                        <div className="flex gap-1.5 flex-wrap">
                          {whatTheyProduce.map((wp) => (
                            <span
                              key={wp}
                              className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{
                                background: `rgba(${rgb}, 0.1)`,
                                color: projectColor,
                              }}
                            >
                              {wp}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Specialties */}
                    {gnome.categories.length > 0 && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest opacity-50 mb-1.5">
                          Specialties
                        </p>
                        <div className="flex gap-1.5 flex-wrap">
                          {gnome.categories.map((cat) => (
                            <span
                              key={cat}
                              className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 opacity-70"
                            >
                              {humanizeCategory(cat)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tools */}
                    {gnome.toolProviders.length > 0 && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest opacity-50 mb-1.5">
                          Tools
                        </p>
                        <div className="flex gap-1.5 flex-wrap">
                          {gnome.toolProviders.map((tp) => (
                            <span
                              key={tp}
                              className="text-[9px] px-2 py-0.5 rounded bg-white/[0.04] opacity-60"
                            >
                              {humanizeToolProvider(tp)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
