/**
 * media_library built-in — Phase 5 port from `agents/tools/registry.ts:306-759`.
 *
 * Four tools, ported as faithfully as possible:
 *   - browse_media_library  — search APPROVED assets in a project
 *   - attach_media          — attach an existing asset to current work product
 *   - request_media_design  — open a designer task + queue attachment
 *   - capture_screenshot    — Playwright screenshot via screenshot.service
 *
 * Key port differences from the legacy version:
 *   - `prisma` comes from `ctx.prisma` instead of a fresh import
 *   - `executionId` defaults to `ctx.executionId` if the agent omits it,
 *     since under Managed Agents the dispatcher always knows the execution
 *   - `projectSlug` defaults to `ctx.projectSlug` for the same reason
 *   - `tacticId` defaults to `ctx.tacticId`
 * The legacy interface still accepts these as inputs from the gnome's prompt
 * for backward compatibility with existing system prompts.
 */

import type { PlatformToolContext } from "../types";
import { registerPlatformTool } from "../registry";

function pickProjectSlug(input: Record<string, unknown>, ctx: PlatformToolContext): string {
  return (input.projectSlug as string) || ctx.projectSlug;
}

function pickExecutionId(input: Record<string, unknown>, ctx: PlatformToolContext): string {
  return (input.executionId as string) || ctx.executionId;
}

function pickTacticId(input: Record<string, unknown>, ctx: PlatformToolContext): string {
  return (input.tacticId as string) || ctx.tacticId;
}

registerPlatformTool({
  name: "browse_media_library",
  description:
    "Search the project's approved media library for images matching the given tags " +
    "or title keywords. Use this before creating new images to check what's already available. " +
    "Returns a list of approved media assets with their IDs, titles, tags, and image URLs.",
  inputSchema: {
    type: "object",
    properties: {
      projectSlug: {
        type: "string",
        description: "The project slug (from your context — optional, dispatcher fills this in).",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Tags to filter by (e.g. ['hero', 'screenshot', 'dashboard']). Returns assets matching ANY of these tags.",
      },
    },
    required: [],
  },
  requiredSources: [],
  hasSideEffects: false,
  provider: "media_library",
  execute: async (input, ctx) => {
    const { MediaService } = await import("@/services");
    const assets = await MediaService.listMediaAssets({
      projectSlug: pickProjectSlug(input, ctx),
      status: "APPROVED",
      tags: (input.tags as string[]) ?? undefined,
    });
    return {
      count: assets.length,
      assets: assets.map((a: (typeof assets)[number]) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        imageUrl: a.imageUrl,
        thumbnailUrl: a.thumbnailUrl,
        tags: a.tags,
        description: a.description,
        contentHash: a.contentHash,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
      })),
    };
  },
});

registerPlatformTool({
  name: "attach_media",
  description:
    "Attach an existing media asset to the current work product. " +
    "Call browse_media_library first to find assets, then use this to attach one by ID. " +
    "You can optionally provide alt text for accessibility. " +
    "If the work product hasn't been created yet, the attachment is queued and applied " +
    "automatically when you submit the work product.",
  inputSchema: {
    type: "object",
    properties: {
      workProductId: {
        type: "string",
        description: "The ID of the current work product (if it exists already).",
      },
      executionId: {
        type: "string",
        description:
          "The execution ID (optional — dispatcher fills this in). Used to queue the attachment if the work product doesn't exist yet.",
      },
      mediaAssetId: {
        type: "string",
        description: "The ID of the media asset to attach (from browse_media_library results).",
      },
      altText: {
        type: "string",
        description: "Alt text for the image in this specific usage (for accessibility).",
      },
    },
    required: ["mediaAssetId"],
  },
  requiredSources: [],
  hasSideEffects: true,
  provider: "media_library",
  execute: async (input, ctx) => {
    const { MediaAttachmentService } = await import("@/services");
    const mediaAssetId = input.mediaAssetId as string;
    const workProductId = input.workProductId as string | undefined;
    const executionId = pickExecutionId(input, ctx);
    const altText = (input.altText as string) ?? undefined;

    // Try direct attachment if workProductId is provided
    if (workProductId) {
      try {
        const attachment = await MediaAttachmentService.attachMedia({
          workProductId,
          mediaAssetId,
          altText,
          source: "GNOME_SUGGESTED",
        });
        const att = attachment as typeof attachment & {
          mediaAsset?: { title?: string; imageUrl?: string | null };
        };
        return {
          attached: true,
          queued: false,
          attachmentId: attachment.id,
          mediaAssetTitle: att.mediaAsset?.title ?? null,
          imageUrl: att.mediaAsset?.imageUrl ?? null,
        };
      } catch {
        // WorkProduct might not exist yet — fall through to queue
      }
    }

    // Queue the attachment on the execution for auto-attach after submit_work_product
    if (executionId) {
      await ctx.prisma.taskExecution.update({
        where: { id: executionId },
        data: {
          pendingMediaIds: { push: mediaAssetId },
        },
      });
      return {
        attached: false,
        queued: true,
        mediaAssetId,
        note: "Media queued — will be attached automatically when the work product is submitted.",
      };
    }

    return {
      attached: false,
      queued: false,
      error: "Provide either workProductId or executionId to attach media.",
    };
  },
});

registerPlatformTool({
  name: "request_media_design",
  description:
    "Request a new image to be designed or generated. Creates a media asset in " +
    "REQUESTED status with your design brief, creates a sibling task assigned to the " +
    "designer gnome, and attaches the (pending) asset to the current work product. " +
    "Delivery of the work product will be gated until the image is approved. " +
    "Use this when browse_media_library returns nothing suitable and you need a " +
    "custom image for the post.",
  inputSchema: {
    type: "object",
    properties: {
      projectSlug: {
        type: "string",
        description: "The project slug (optional — dispatcher fills this in).",
      },
      tacticId: {
        type: "string",
        description:
          "The tactic ID (optional — dispatcher fills this in) — the new designer task will be added to this tactic.",
      },
      workProductId: {
        type: "string",
        description:
          "The ID of the current work product to attach the image to (optional — omit if this is just a general request).",
      },
      executionId: {
        type: "string",
        description: "The execution ID (optional — dispatcher fills this in).",
      },
      title: {
        type: "string",
        description: "Short title for the media asset (e.g. 'Ohio map dashboard screenshot').",
      },
      brief: {
        type: "string",
        description:
          "Detailed design brief describing what image is needed, including style, mood, " +
          "dimensions, key elements, and how it will be used in the post. Be specific enough " +
          "that a designer or AI generator can produce the image without additional context.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for the requested asset (e.g. ['hero', 'screenshot', 'map']).",
      },
      designerGnomeSlug: {
        type: "string",
        description: "Slug of the designer gnome to assign. Defaults to 'designer-gnome'.",
      },
    },
    required: ["title", "brief"],
  },
  requiredSources: [],
  hasSideEffects: true,
  provider: "media_library",
  execute: async (input, ctx) => {
    const { MediaService, MediaAttachmentService } = await import("@/services");

    const projectSlug = pickProjectSlug(input, ctx);
    const tacticId = pickTacticId(input, ctx);
    const title = input.title as string;
    const brief = input.brief as string;
    const tags = (input.tags as string[]) ?? [];
    const workProductId = input.workProductId as string | undefined;
    const executionId = pickExecutionId(input, ctx);
    const designerSlug = (input.designerGnomeSlug as string) ?? "designer-gnome";

    // 1. Create the MediaAsset in REQUESTED status
    const asset = await MediaService.createMediaAsset({
      projectSlug,
      title,
      description: brief,
      tags,
      status: "REQUESTED",
      requestBrief: brief,
      sourceType: "DESIGNER_REQUEST",
    });

    // 2. Create a sibling Task on the same tactic, assigned to the designer gnome.
    const task = await ctx.prisma.task.create({
      data: {
        tacticId,
        title: `Design: ${title}`,
        description:
          `Create an image based on this brief:\n\n${brief}\n\n` +
          `The resulting image should be saved to media asset ${asset.id} ("${title}").`,
        status: "TODO",
        assigneeType: "AGENT",
        assigneeId: designerSlug,
        priority: "MEDIUM",
      },
    });

    // 3. Attach the (pending) asset to the work product, or queue for later
    let attachmentId: string | undefined;
    let queued = false;
    if (workProductId) {
      try {
        const att = await MediaAttachmentService.attachMedia({
          workProductId,
          mediaAssetId: asset.id,
          source: "GNOME_SUGGESTED",
        });
        attachmentId = att.id;
      } catch {
        // WorkProduct doesn't exist yet — fall through to queue
      }
    }
    if (!attachmentId && executionId) {
      await ctx.prisma.taskExecution.update({
        where: { id: executionId },
        data: { pendingMediaIds: { push: asset.id } },
      });
      queued = true;
    }

    return {
      mediaAssetId: asset.id,
      mediaAssetSlug: asset.slug,
      designerTaskId: task.id,
      designerGnomeSlug: designerSlug,
      attachmentId: attachmentId ?? null,
      queued,
      note:
        `Design request opened. Task "${task.title}" assigned to ${designerSlug}. ` +
        (queued
          ? `Media attachment queued — will be linked when work product is submitted. `
          : ``) +
        `The work product delivery will wait until the image is approved.`,
    };
  },
});

registerPlatformTool({
  name: "capture_screenshot",
  description:
    "Capture a screenshot of a web page or specific element. Creates a media asset " +
    "with the captured image. Useful for product screenshots, dashboard views, " +
    "landing pages, etc. The screenshot is stored as a DRAFT media asset — " +
    "a human will need to approve it before it can be used in delivery.",
  inputSchema: {
    type: "object",
    properties: {
      projectSlug: {
        type: "string",
        description: "The project slug (optional — dispatcher fills this in).",
      },
      url: {
        type: "string",
        description:
          "Full URL to capture (e.g. 'https://solostates.solostream.io/dashboard').",
      },
      title: {
        type: "string",
        description: "Title for the captured asset (e.g. 'SoloStates dashboard overview').",
      },
      selector: {
        type: "string",
        description:
          "Optional CSS selector to capture a specific element instead of the full page (e.g. '#map-container').",
      },
      viewport: {
        type: "object",
        properties: {
          width: { type: "number", description: "Viewport width in pixels (default 1280)." },
          height: { type: "number", description: "Viewport height in pixels (default 720)." },
        },
      },
      waitForSelector: {
        type: "string",
        description: "CSS selector to wait for before capturing (for dynamic content).",
      },
      delayMs: {
        type: "number",
        description: "Additional delay in ms after page load before capturing (for animations).",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for the captured asset.",
      },
      workProductId: {
        type: "string",
        description: "If provided, auto-attach the screenshot to this work product.",
      },
      executionId: {
        type: "string",
        description: "The execution ID (optional — dispatcher fills this in).",
      },
    },
    required: ["url", "title"],
  },
  requiredSources: [],
  hasSideEffects: true,
  provider: "media_library",
  execute: async (input, ctx) => {
    const { MediaService, MediaAttachmentService, StorageService } = await import(
      "@/services"
    );
    const { captureScreenshot } = await import("@/services/screenshot.service");

    const projectSlug = pickProjectSlug(input, ctx);
    const url = input.url as string;
    const title = input.title as string;
    const tags = (input.tags as string[]) ?? ["screenshot"];
    const workProductId = input.workProductId as string | undefined;
    const executionId = pickExecutionId(input, ctx);

    const captureSpec = {
      url,
      selector: (input.selector as string) ?? null,
      viewport:
        (input.viewport as { width: number; height: number }) ?? { width: 1280, height: 720 },
      waitForSelector: (input.waitForSelector as string) ?? null,
      delayMs: (input.delayMs as number) ?? 0,
    };

    // 1. Create the MediaAsset in REQUESTED status (so it exists even if capture fails)
    const asset = await MediaService.createMediaAsset({
      projectSlug,
      title,
      description: `Screenshot of ${url}`,
      tags: [...tags, "screenshot"],
      status: "REQUESTED",
      requestBrief: JSON.stringify(captureSpec, null, 2),
      sourceType: "SCREENSHOT_GNOME",
      sourceUrl: url,
    });

    // 2. Capture the screenshot
    let screenshotResult;
    try {
      screenshotResult = await captureScreenshot(captureSpec);
    } catch (err) {
      return {
        mediaAssetId: asset.id,
        status: "REQUESTED",
        error: true,
        message: `Screenshot capture failed: ${err instanceof Error ? err.message : String(err)}`,
        note: "The media asset was created in REQUESTED status. You can retry or use generate_image as a fallback.",
      };
    }

    // 3. Upload to R2 if configured, otherwise use a data URL fallback
    let imageUrl: string;
    let storageKey: string | undefined;
    let contentHash: string | undefined;

    if (StorageService.isConfigured()) {
      const key = `media/${projectSlug}/${asset.id}/screenshot.png`;
      const upload = await StorageService.uploadBuffer(
        screenshotResult.buffer,
        key,
        "image/png",
      );
      imageUrl = upload.publicUrl;
      storageKey = upload.storageKey;
      contentHash = upload.contentHash;
    } else {
      if (screenshotResult.buffer.length > 4 * 1024 * 1024) {
        return {
          mediaAssetId: asset.id,
          status: "REQUESTED",
          error: true,
          message: "Screenshot too large for data URL fallback. Configure R2 storage.",
        };
      }
      imageUrl = `data:image/png;base64,${screenshotResult.buffer.toString("base64")}`;
    }

    // 4. Update the asset to DRAFT with the captured image
    const updated = await MediaService.updateMediaAsset(asset.id, {
      imageUrl,
      storageKey,
      contentHash,
      mimeType: "image/png",
      width: screenshotResult.width,
      height: screenshotResult.height,
      sizeBytes: screenshotResult.buffer.length,
      status: "DRAFT",
    });

    // 5. Attach to work product if requested
    let attachmentId: string | undefined;
    let queued = false;
    if (workProductId) {
      try {
        const att = await MediaAttachmentService.attachMedia({
          workProductId,
          mediaAssetId: asset.id,
          source: "GNOME_SUGGESTED",
        });
        attachmentId = att.id;
      } catch {
        // WorkProduct doesn't exist yet — fall through to queue
      }
    }
    if (!attachmentId && executionId) {
      await ctx.prisma.taskExecution.update({
        where: { id: executionId },
        data: { pendingMediaIds: { push: asset.id } },
      });
      queued = true;
    }

    return {
      mediaAssetId: asset.id,
      status: "DRAFT",
      imageUrl: updated.imageUrl,
      storageKey: storageKey ?? null,
      width: screenshotResult.width,
      height: screenshotResult.height,
      sizeBytes: screenshotResult.buffer.length,
      attachmentId: attachmentId ?? null,
      queued,
      note:
        `Screenshot captured and saved as DRAFT media asset "${title}". ` +
        (storageKey ? `Stored in R2 at ${storageKey}. ` : "") +
        "A human will need to approve it before delivery.",
    };
  },
});
