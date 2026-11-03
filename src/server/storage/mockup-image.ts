import { imageSize } from "image-size";
import { MOCKUP_MIME_TYPES } from "../../shared/pages";

export type MockupImageType = keyof typeof MOCKUP_MIME_TYPES;

/**
 * The type and size of a PNG, JPEG, GIF, or WebP image, read from its bytes
 * whatever its name says; null for anything else, like SVG, which can carry
 * scripts.
 */
export function checkMockupImage(
  data: Uint8Array,
): { type: MockupImageType; width: number; height: number } | null {
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(data);
  } catch {
    return null;
  }
  if (
    !size.type ||
    !Object.hasOwn(MOCKUP_MIME_TYPES, size.type) ||
    typeof size.width !== "number" ||
    typeof size.height !== "number"
  ) {
    return null;
  }
  return {
    type: size.type as MockupImageType,
    width: size.width,
    height: size.height,
  };
}
