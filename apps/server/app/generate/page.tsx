'use client';

import { GenerateFlow } from '@showboxes/player/pipeline/GenerateFlow';
import '@showboxes/player/styles.css';

export default function GeneratePage() {
  // To experiment with content size, pass e.g. designSize={{ width: 1000, height: 1000 }}.
  // Smaller values enlarge rendered content in the same host frame.
  return <GenerateFlow />;
}
