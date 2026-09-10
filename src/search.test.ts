import assert from "node:assert/strict";
import test from "node:test";
import { commandForClipboard, detectRisk, isDangerous, looksLikeCommand } from "./search.js";

test("recognizes command-shaped source excerpts", () => {
  assert.equal(looksLikeCommand("$ docker ps"), true);
  assert.equal(looksLikeCommand("这是一段概念解释"), false);
});

test("danger matrix blocks destructive copies", () => {
  const high = [
    "rm -r ./cache", "rm -fr /tmp/work", "rm ./cache -rf", "sudo -n rm ./cache -rf",
    "env MODE=cleanup rm ./cache --recursive", "sudo -u root env --chdir /tmp MODE=cleanup rm cache -fr",
    "/usr/bin/env -u SAFE /bin/rm target -r", "git reset --hard HEAD~1", "git push --force origin main",
    "Remove-Item x -Recurse", "chmod -R 777 .", "DROP DATABASE app", "mysql db < dump.sql",
    "DELETE FROM users", "UPDATE users SET active = false", "INSERT INTO audit VALUES (1)",
  ];
  const critical = ["dd if=image.iso of=/dev/sda", "mkfs.ext4 /dev/sdb", "shutdown -r now"];
  for (const command of high) assert.equal(detectRisk(command), "high", command);
  for (const command of critical) assert.equal(detectRisk(command), "critical", command);
  assert.equal(isDangerous("docker ps"), false);
  assert.equal(detectRisk("git status"), "low");
});

test("copies executable code from a Markdown fence without copying fence markers", () => {
  assert.equal(commandForClipboard("```sh\ndocker ps\n```"), "docker ps");
  assert.equal(commandForClipboard("docker ps"), "docker ps");
});
