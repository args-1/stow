import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Padded icons (maskable, apple-touch) fill their padding with the canvas colour instead of white.
const paddedBackground = { fit: 'contain', background: '#fefaf3' } as const;

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: paddedBackground },
    apple: { ...minimal2023Preset.apple, resizeOptions: paddedBackground },
  },
  images: ['public/logo.svg'],
});
