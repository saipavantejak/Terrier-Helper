import { writeFile } from "node:fs/promises";
await writeFile(
  new URL("../dist-widget/package.json", import.meta.url),
  JSON.stringify(
    {
      name: "@terrier-helper/react",
      version: "1.1.0",
      type: "module",
      description: "Embeddable college knowledge assistant UI",
      main: "./terrier-helper.js",
      types: "./widget.d.ts",
      exports: {
        ".": { types: "./widget.d.ts", import: "./terrier-helper.js" },
        "./style.css": "./terrier-helper.css",
      },
      peerDependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      sideEffects: ["*.css"],
    },
    null,
    2,
  ) + "\n",
);
