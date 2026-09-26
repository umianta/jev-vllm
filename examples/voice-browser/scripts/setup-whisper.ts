// Build whisper.cpp's HTTP server and download a model, for local speech-to-text.
//
//   bun scripts/setup-whisper.ts                 # small.en, CUDA if nvcc is found
//   bun scripts/setup-whisper.ts --model base.en --cpu
//
// Installs into $WHISPER_HOME (default ~/.cache/jev-voice/whisper.cpp) and prints
// the command that starts the server.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    model: { type: "string", default: "small.en" },
    cpu: { type: "boolean", default: false },
    ref: { type: "string", default: "v1.9.4" },
  },
});

const home = process.env.WHISPER_HOME ?? join(homedir(), ".cache/jev-voice/whisper.cpp");
const nvcc = Bun.which("nvcc") ?? (existsSync("/usr/local/cuda/bin/nvcc") ? "/usr/local/cuda/bin/nvcc" : null);
const cuda = !opts.cpu && nvcc !== null;

function run(cmd: string[], cwd?: string) {
  console.log(`$ ${cmd.join(" ")}`);
  const env = cuda ? { ...process.env, PATH: `${join(nvcc!, "..")}:${process.env.PATH}` } : process.env;
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
}

if (!existsSync(home)) {
  run(["git", "clone", "--depth", "1", "--branch", opts.ref!, "https://github.com/ggml-org/whisper.cpp", home]);
}

const cmakeArgs = ["-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DWHISPER_BUILD_SERVER=ON", "-DWHISPER_BUILD_TESTS=OFF"];
if (cuda) cmakeArgs.push("-DGGML_CUDA=ON", "-DCMAKE_CUDA_ARCHITECTURES=native");
run(["cmake", ...cmakeArgs], home);
run(["cmake", "--build", "build", "-j", "--config", "Release", "--target", "whisper-server"], home);

const model = join(home, "models", `ggml-${opts.model}.bin`);
if (!existsSync(model)) run(["bash", "models/download-ggml-model.sh", opts.model!], home);

console.log(`
whisper.cpp ready (${cuda ? "CUDA" : "CPU"}). Start the server with:

  ${join(home, "build/bin/whisper-server")} -m ${model} --host 127.0.0.1 --port 8178 -nt
`);
