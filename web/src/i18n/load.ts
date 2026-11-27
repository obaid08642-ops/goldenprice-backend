// Server/build only: registers every language dictionary (JSON files in ./lang).
import { registerDict, type Dict } from "./ui";
const files = import.meta.glob("./lang/*.json", { eager: true, import: "default" }) as Record<string, Dict>;
for (const [p, d] of Object.entries(files)) registerDict(p.match(/lang\/(.+)\.json$/)![1], d);
