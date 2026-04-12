/**
 * ai_image_generation built-in — Phase 5 port from
 * `agents/tools/registry.ts:773-1009`.
 *
 * Two tools:
 *   - generate_image     — calls FAL.ai Flux Pro and polls for completion
 *   - update_media_asset — writes a generated image back to a MediaAsset row
 *
 * No credentials. Belongs to the `ai_image_generation` provider. Used by the
 * designer gnome to fulfill `request_media_design` tasks.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "generate_image",
  description:
    "Generate an image using AI (Flux Pro via FAL.ai). Provide a detailed text prompt " +
    "describing the desired image. Returns the generated image URL. You can specify " +
    "dimensions and a seed for reproducibility.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed text prompt for the image. Be specific about subject, style, " +
          "composition, colors, lighting, and mood.",
      },
      width: {
        type: "number",
        description: "Image width in pixels. Common sizes: 1200 (LinkedIn), 1080 (Instagram square).",
      },
      height: {
        type: "number",
        description: "Image height in pixels. Common sizes: 627 (LinkedIn), 1080 (Instagram square).",
      },
      seed: {
        type: "number",
        description:
          "Random seed for reproducible results. Use the same seed to get similar outputs when iterating on a prompt.",
      },
      num_images: {
        type: "number",
        description:
          "Number of images to generate (default 1, max 4). Useful for giving the reviewer options.",
      },
    },
    required: ["prompt"],
  },
  requiredSources: [],
  hasSideEffects: true,
  provider: "ai_image_generation",
  execute: async (input) => {
    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      return {
        error: true,
        message:
          "FAL_KEY environment variable is not set. Please add your FAL.ai API key " +
          "to the environment to enable AI image generation.",
      };
    }

    const prompt = input.prompt as string;
    const width = (input.width as number) ?? 1200;
    const height = (input.height as number) ?? 627;
    const seed = input.seed as number | undefined;
    const numImages = Math.min((input.num_images as number) ?? 1, 4);

    try {
      const submitRes = await fetch("https://queue.fal.run/fal-ai/flux-pro/v1.1", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          image_size: { width, height },
          num_images: numImages,
          ...(seed !== undefined ? { seed } : {}),
          enable_safety_checker: true,
        }),
      });

      if (!submitRes.ok) {
        const errBody = await submitRes.text();
        return {
          error: true,
          message: `FAL.ai submit failed (${submitRes.status}): ${errBody}`,
        };
      }

      const submitData = await submitRes.json();
      const requestId = submitData.request_id;
      const statusUrl =
        submitData.status_url ||
        `https://queue.fal.run/fal-ai/flux-pro/requests/${requestId}/status`;

      // Poll for completion (up to 60 seconds)
      const maxWait = 60_000;
      const pollInterval = 2_000;
      const start = Date.now();

      while (Date.now() - start < maxWait) {
        await new Promise((r) => setTimeout(r, pollInterval));

        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${falKey}` },
        });

        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();

        if (statusData.status === "COMPLETED") {
          const resultUrl =
            statusData.response_url ??
            `https://queue.fal.run/fal-ai/flux-pro/requests/${requestId}`;
          const resultRes = await fetch(resultUrl, {
            headers: { Authorization: `Key ${falKey}` },
          });

          if (!resultRes.ok) {
            return { error: true, message: "Failed to fetch generation result" };
          }

          const resultData = await resultRes.json();
          const images = resultData.images ?? [];

          return {
            success: true,
            images: images.map(
              (
                img: {
                  url: string;
                  width?: number;
                  height?: number;
                  content_type?: string;
                },
                i: number,
              ) => ({
                index: i,
                url: img.url,
                width: img.width ?? width,
                height: img.height ?? height,
                contentType: img.content_type ?? "image/jpeg",
              }),
            ),
            seed: resultData.seed,
            prompt,
            requestId,
            note: `Generated ${images.length} image(s). Use update_media_asset to save the chosen image to the media library.`,
          };
        }

        if (statusData.status === "FAILED") {
          return {
            error: true,
            message: `Image generation failed: ${statusData.error || "Unknown error"}`,
          };
        }
      }

      return { error: true, message: "Image generation timed out after 60 seconds" };
    } catch (err) {
      return {
        error: true,
        message: `Image generation error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

registerPlatformTool({
  name: "update_media_asset",
  description:
    "Update an existing media asset in the library. Use this after generate_image to " +
    "save the generated image URL to a REQUESTED media asset, transitioning it to DRAFT " +
    "status. Also use to update tags, description, or other metadata.",
  inputSchema: {
    type: "object",
    properties: {
      mediaAssetId: {
        type: "string",
        description: "The ID of the media asset to update.",
      },
      imageUrl: {
        type: "string",
        description: "The generated image URL to set.",
      },
      thumbnailUrl: {
        type: "string",
        description: "Optional thumbnail URL.",
      },
      status: {
        type: "string",
        enum: ["REQUESTED", "IN_PROGRESS", "DRAFT", "APPROVED", "ARCHIVED"],
        description: "New status. Typically set to DRAFT after generating an image.",
      },
      description: {
        type: "string",
        description: "Updated description.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Updated tags.",
      },
      width: { type: "number", description: "Image width in pixels." },
      height: { type: "number", description: "Image height in pixels." },
      mimeType: { type: "string", description: "MIME type (e.g. 'image/jpeg')." },
      contentHash: { type: "string", description: "SHA-256 hash of image bytes if known." },
      sourceType: {
        type: "string",
        enum: [
          "MANUAL",
          "UPLOAD",
          "SCREENSHOT_GNOME",
          "AI_GNOME",
          "DESIGNER_REQUEST",
          "EXTERNAL_LINK",
        ],
        description: "How this image was produced. Typically AI_GNOME for generated images.",
      },
    },
    required: ["mediaAssetId"],
  },
  requiredSources: [],
  hasSideEffects: true,
  provider: "ai_image_generation",
  execute: async (input) => {
    const { MediaService, StorageService } = await import("@/services");
    const id = input.mediaAssetId as string;

    const updateData: Record<string, unknown> = {};
    if (input.imageUrl !== undefined) updateData.imageUrl = input.imageUrl;
    if (input.thumbnailUrl !== undefined) updateData.thumbnailUrl = input.thumbnailUrl;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.width !== undefined) updateData.width = input.width;
    if (input.height !== undefined) updateData.height = input.height;
    if (input.mimeType !== undefined) updateData.mimeType = input.mimeType;
    if (input.contentHash !== undefined) updateData.contentHash = input.contentHash;
    if (input.sourceType !== undefined) updateData.sourceType = input.sourceType;

    // Persist external image URLs to R2 (FAL.ai URLs expire quickly)
    const imageUrl = input.imageUrl as string | undefined;
    if (imageUrl?.startsWith("http") && StorageService.isConfigured()) {
      try {
        const key = `media/${id}/generated.jpg`;
        const upload = await StorageService.uploadFromUrl(imageUrl, key);
        updateData.imageUrl = upload.publicUrl;
        updateData.storageKey = upload.storageKey;
        updateData.sizeBytes = upload.sizeBytes;
        updateData.contentHash = upload.contentHash;
      } catch (err) {
        console.warn(
          `[update_media_asset] R2 upload failed, keeping external URL: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const updated = await MediaService.updateMediaAsset(
      id,
      updateData as Parameters<typeof MediaService.updateMediaAsset>[1],
    );

    return {
      success: true,
      mediaAssetId: updated.id,
      title: updated.title,
      status: updated.status,
      imageUrl: updated.imageUrl,
      storedInR2: !!updated.storageKey,
      note:
        `Media asset "${updated.title}" updated to status ${updated.status}.` +
        (updated.storageKey ? ` Image persisted to R2.` : ``),
    };
  },
});
