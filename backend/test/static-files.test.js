const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

async function withServer(callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Express does not serve environment files', async () => {
  await withServer(async (baseUrl) => {
    for (const path of ['/.env', '/js/../.env']) {
      const response = await fetch(baseUrl + path);
      assert.ok(response.status === 403 || response.status === 404, `${path} returned ${response.status}`);
    }
  });
});
