// Deploy DiffusionGemma + djev: download the model into a host cache, then
// apply the kustomization with that cache path filled in.
//
//   bun scripts/deploy.ts                                  # kubectl, ~/.cache/huggingface
//   bun scripts/deploy.ts --kubectl "sudo k3s kubectl"
//   bun scripts/deploy.ts --hf-cache /data/hf --uid 1000 --gid 1000
//   bun scripts/deploy.ts --dry-run                        # print manifests, apply nothing
//
// Run it on the GPU node itself, or pass --hf-cache as the path on that node
// (and --uid/--gid of its owner). The manifests use hostPath volumes, so the
// download job and the pods must land on the same node.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "..");
const PLACEHOLDER = "/var/lib/jev-vllm/hf-cache";
const NS = "jev-vllm";

const { values: opts } = parseArgs({
  options: {
    "hf-cache": { type: "string", default: join(homedir(), ".cache/huggingface") },
    kubectl: { type: "string", default: process.env.KUBECTL ?? "kubectl" },
    uid: { type: "string" },
    gid: { type: "string" },
    "skip-download": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opts.help) {
  console.log(readFileSync(import.meta.path, "utf8").split("\nimport")[0].replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

const hfCache = resolve(opts["hf-cache"]!);
const kubectl = opts.kubectl!.split(/\s+/);

// The download job writes as the cache owner, so a root-owned hostPath is never needed.
if (!opts["dry-run"] && !existsSync(hfCache)) {
  mkdirSync(hfCache, { recursive: true });
  console.log(`created ${hfCache}`);
}
const owner = existsSync(hfCache) ? statSync(hfCache) : { uid: process.getuid!(), gid: process.getgid!() };
const uid = opts.uid ?? String(owner.uid);
const gid = opts.gid ?? String(owner.gid);

function k(args: string[], input?: string) {
  if (opts["dry-run"] && args[0] !== "kustomize") return "";
  const p = Bun.spawnSync([...kubectl, ...args], {
    cwd: ROOT,
    stdin: input === undefined ? "inherit" : Buffer.from(input),
    stdout: args[0] === "kustomize" ? "pipe" : "inherit",
    stderr: "inherit",
  });
  if (p.exitCode !== 0) {
    console.error(`\nfailed: ${[...kubectl, ...args].join(" ")}`);
    process.exit(p.exitCode ?? 1);
  }
  return p.stdout?.toString() ?? "";
}

function apply(yaml: string) {
  if (opts["dry-run"]) return console.log(`---\n${yaml}`);
  k(["apply", "-f", "-"], yaml);
}

const fill = (yaml: string) =>
  yaml
    .replaceAll(PLACEHOLDER, hfCache)
    .replace(/runAsUser: 1000\b/, `runAsUser: ${uid}`)
    .replace(/runAsGroup: 1000\b/, `runAsGroup: ${gid}`);

console.log(`hf cache: ${hfCache} (uid ${uid}, gid ${gid})\nkubectl:  ${kubectl.join(" ")}\n`);

apply(readFileSync(join(ROOT, "k8s/00-namespace.yaml"), "utf8"));

if (!opts["skip-download"]) {
  // A Job's pod template is immutable; re-running is cheap since files already present are skipped.
  k(["-n", NS, "delete", "job", "download-diffusiongemma", "--ignore-not-found"]);
  apply(fill(readFileSync(join(ROOT, "k8s/05-download-job.yaml"), "utf8")));
  console.log("\ndownloading the model (~19 GB); first run takes a while...");
  k(["-n", NS, "wait", "--for=condition=complete", "job/download-diffusiongemma", "--timeout=60m"]);
}

apply(fill(k(["kustomize", "."])));

if (!opts["dry-run"]) {
  console.log(`
Applied. The first start pulls a ~9.7 GB image and loads weights; watch with:
  ${kubectl.join(" ")} -n ${NS} get pods -w

Then:
  ${kubectl.join(" ")} -n ${NS} port-forward svc/djev 8011:8011
  curl -s localhost:8011/v1/systemone -H 'content-type: application/json' -d @client/payloads/1-choice.json`);
}
