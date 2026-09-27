import type { FontInfo } from "./types";

const OFL = "OFL-1.1";
const JAPANESE = ["latin", "kana", "kanji"];

/**
 * Fonts shipped with the app in `public/fonts/` (unmodified static TTFs, see THIRD_PARTY_FONTS.md).
 * The ids are the same as in TypeFab so that both projects can share documents and this package.
 */
export const BUNDLED_FONTS: FontInfo[] = [
  {
    id: "zen",
    family: "Zen Kaku Gothic New",
    bundled: true,
    vertical: true,
    file: "ZenKakuGothicNew-Regular.ttf",
    license: OFL,
    licenseFile: "ZenKakuGothicNew-OFL.txt",
    copyright: "Copyright 2022 The Zen Kaku Gothic Project Authors (https://github.com/googlefonts/zen-kakugothic)",
    source: "https://github.com/google/fonts/tree/main/ofl/zenkakugothicnew",
    category: "gothic",
    scripts: JAPANESE,
  },
  {
    id: "shippori",
    family: "Shippori Mincho",
    bundled: true,
    vertical: true,
    file: "ShipporiMincho-Regular.ttf",
    license: OFL,
    licenseFile: "ShipporiMincho-OFL.txt",
    copyright: "Copyright 2021 The Shippori Mincho Project Authors (https://github.com/fontdasu/ShipporiMincho)",
    source: "https://github.com/google/fonts/tree/main/ofl/shipporimincho",
    category: "mincho",
    scripts: JAPANESE,
  },
  {
    id: "zenmaru",
    family: "Zen Maru Gothic",
    bundled: true,
    vertical: true,
    file: "ZenMaruGothic-Regular.ttf",
    license: OFL,
    licenseFile: "ZenMaruGothic-OFL.txt",
    copyright: "Copyright 2021 The Zen Maru Gothic Project Authors (https://github.com/googlefonts/zen-marugothic)",
    source: "https://github.com/google/fonts/tree/main/ofl/zenmarugothic",
    category: "rounded",
    scripts: JAPANESE,
  },
  {
    id: "delagothic",
    family: "Dela Gothic One",
    bundled: true,
    vertical: true,
    file: "DelaGothicOne-Regular.ttf",
    license: OFL,
    licenseFile: "DelaGothicOne-OFL.txt",
    copyright: "Copyright 2020 The Dela Gothic Project Authors (https://github.com/syakuzen/DelaGothic)",
    source: "https://github.com/google/fonts/tree/main/ofl/delagothicone",
    category: "display",
    scripts: JAPANESE,
  },
  {
    id: "rocknroll",
    family: "RocknRoll One",
    bundled: true,
    vertical: true,
    file: "RocknRollOne-Regular.ttf",
    license: OFL,
    licenseFile: "RocknRollOne-OFL.txt",
    copyright: "Copyright 2020 The RocknRoll Project Authors (https://github.com/fontworks-fonts/RocknRoll)",
    source: "https://github.com/google/fonts/tree/main/ofl/rocknrollone",
    category: "display",
    scripts: JAPANESE,
  },
  {
    id: "kaiseidecol",
    family: "Kaisei Decol",
    bundled: true,
    vertical: true,
    file: "KaiseiDecol-Regular.ttf",
    license: OFL,
    licenseFile: "KaiseiDecol-OFL.txt",
    copyright: "Copyright 2020 The Kaisei Project Authors (https://github.com/Font-Kai/Kaisei)",
    source: "https://github.com/google/fonts/tree/main/ofl/kaiseidecol",
    category: "mincho",
    scripts: JAPANESE,
  },
  {
    id: "zenkurenaido",
    family: "Zen Kurenaido",
    bundled: true,
    vertical: true,
    file: "ZenKurenaido-Regular.ttf",
    license: OFL,
    licenseFile: "ZenKurenaido-OFL.txt",
    copyright: "Copyright 2021 The Zen Kurenaido Project Authors (https://github.com/googlefonts/zen-kurenaido)",
    source: "https://github.com/google/fonts/tree/main/ofl/zenkurenaido",
    category: "handwriting",
    scripts: JAPANESE,
  },
  {
    id: "dotgothic",
    family: "DotGothic16",
    bundled: true,
    vertical: true,
    file: "DotGothic16-Regular.ttf",
    license: OFL,
    licenseFile: "DotGothic16-OFL.txt",
    copyright: "Copyright 2020 The DotGothic16 Project Authors (https://github.com/fontworks-fonts/DotGothic16)",
    source: "https://github.com/google/fonts/tree/main/ofl/dotgothic16",
    category: "pixel",
    scripts: JAPANESE,
  },
];

/** Zen Kaku Gothic New. */
export const DEFAULT_FONT_ID = "zen";

/** Prefix of user font ids. */
export const USER_FONT_PREFIX = "user:";

export const isUserFontId = (id: string): boolean => id.startsWith(USER_FONT_PREFIX);

export const bundledFont = (id: string): FontInfo | null =>
  BUNDLED_FONTS.find((f) => f.id === id) ?? null;
