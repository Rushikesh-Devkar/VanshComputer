const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/modules/leads/lead.model');
const controller = require('../src/modules/leads/lead.controller');

test('lead list is filtered, searched, sorted and paginated at 50', async () => {
  const originalCountDocuments = Lead.countDocuments;
  const originalFind = Lead.find;
  let filterSeen;
  let sortSeen;
  let skipSeen;
  let limitSeen;
  Lead.countDocuments = async (filter) => { filterSeen = filter; return 51; };
  Lead.find = (filter) => ({
    sort(value) { sortSeen = value; return this; },
    skip(value) { skipSeen = value; return this; },
    limit(value) { limitSeen = value; return this; },
    then(resolve) { resolve([{ name: 'Newest lead', phone: '+919999999999', status: 'new' }]); },
  });
  try {
    let body;
    const res = {
      json(value) { body = value; return this; },
      status() { return this; },
    };
    await controller.list({
      query: { page: '2', status: 'new', q: 'Anil' },
    }, res, (error) => { throw error; });
    assert.equal(filterSeen.status, 'new');
    assert.ok(filterSeen.$or[0].name instanceof RegExp);
    assert.deepEqual(sortSeen, { createdAt: -1 });
    assert.equal(skipSeen, 50);
    assert.equal(limitSeen, 50);
    assert.equal(body.total, 51);
    assert.equal(body.page, 2);
    assert.equal(body.pages, 2);
    assert.equal(body.limit, 50);
  } finally {
    Lead.countDocuments = originalCountDocuments;
    Lead.find = originalFind;
  }
});
