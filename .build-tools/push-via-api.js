// 通过 GitHub Git Data API 推送（git 协议走 github.com 被代理断时使用）
// 用法: node push-via-api.js <repo> <branch> <message> <file1> <file2> ...
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const GH = "C:/Program Files/GitHub CLI/gh.exe";
const [repo, branch, message, ...files] = process.argv.slice(2);
if (!repo || !branch || !message || !files.length) {
  console.error("usage: node push-via-api.js <repo> <branch> <message> <files...>");
  process.exit(1);
}

function api(route, input) {
  const args = ["api", route];
  if (input !== undefined) args.push("--input", "-");
  const out = execFileSync(GH, args, { input: input === undefined ? "" : JSON.stringify(input), maxBuffer: 64 * 1024 * 1024 });
  return out.toString();
}

const ref = JSON.parse(api(`repos/${repo}/git/ref/heads/${branch}`));
const baseCommitSha = ref.object.sha;
const baseCommit = JSON.parse(api(`repos/${repo}/git/commits/${baseCommitSha}`));
const baseTree = baseCommit.tree.sha;
console.log("base commit:", baseCommitSha);

const tree = files.map((f) => {
  const content = fs.readFileSync(f);
  const blob = JSON.parse(api(`repos/${repo}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64"
  }));
  console.log("blob:", f, content.length, "bytes");
  return { path: f.replace(/\\/g, "/"), mode: "100644", type: "blob", sha: blob.sha };
});

const newTree = JSON.parse(api(`repos/${repo}/git/trees`, { base_tree: baseTree, tree }));
console.log("tree:", newTree.sha);

const newCommit = JSON.parse(api(`repos/${repo}/git/commits`, {
  message,
  tree: newTree.sha,
  parents: [baseCommitSha]
}));
console.log("commit:", newCommit.sha);

api(`repos/${repo}/git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
console.log("ref updated → push done");
