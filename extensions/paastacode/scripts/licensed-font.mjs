import {mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
// The owner's licensed distribution asset is separate from this MIT source tree.
const response=await fetch("https://paasta.cloud/fonts/yekan-bakh/yekan-bakh-variable.ttf",{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error("Licensed publisher font unavailable");
const bytes=Buffer.from(await response.arrayBuffer());
if(createHash("sha256").update(bytes).digest("hex")!=="b0e32d2ea6447d0d0bf4f13a22dad3adb1a6f5675df370e1674794727c1b8b5f")throw new Error("Publisher font hash mismatch");
await mkdir(".artifacts",{recursive:true});await writeFile(".artifacts/YekanBakh.ttf",bytes);console.log("Publisher's licensed Yekan Bakh asset verified.");
