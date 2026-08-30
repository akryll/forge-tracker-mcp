import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { REDACTED, Secret, forgetSecret, redact, rememberSecret } from "../src/secret.js";

const KEY = "fga_test-key-not-a-real-one-0000000000000000000";

test("обёртка не отдаёт ключ ни через строку, ни через JSON, ни через console", () => {
  const secret = new Secret(KEY);
  assert.equal(String(secret), REDACTED);
  assert.equal(`${secret}`, REDACTED);
  assert.equal(JSON.stringify({ key: secret }), JSON.stringify({ key: REDACTED }));
  assert.equal(inspect(secret), REDACTED);
  assert.ok(!inspect({ key: secret }).includes("fga_"));
  assert.equal(secret.expose(), KEY);
});

test("redact затирает ключ в чужом тексте", () => {
  assert.ok(!redact(`заголовок X-Agent-Key: ${KEY} ушёл в лог`).includes(KEY));
  assert.equal(redact(`ключ ${KEY}`), `ключ ${REDACTED}`);
});

test("redact не трогает подсказку ключа — её Forge показывает намеренно", () => {
  // `hint` в API — первые символы ключа открытым текстом, чтобы человек
  // опознал строку в конфиге. Затирать её незачем.
  assert.equal(redact("hint: fga_ypfv"), "hint: fga_ypfv");
});

test("запомненный ключ затирается, даже если не подходит под шаблон", () => {
  const odd = "fga_короткий";
  rememberSecret(new Secret(odd));
  try {
    assert.equal(redact(`ключ ${odd}`), `ключ ${REDACTED}`);
  } finally {
    forgetSecret();
  }
});
