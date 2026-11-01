// Node-creation unit tests: verify the inlined node helpers reproduce the
// output of gatsby-node-helpers@0.3.0 as used by gatsby-source-mysql.
// Run: node test/node-creation.test.js
const assert = require(`assert`);
const createMysqlNodes = require(`../src/create-mysql-nodes`);

function reporterArgs(list) {
  return {
    createNode: async node => list.push(node),
    store: {},
    createNodeId: id => id,
    cache: new Map(),
    getCache: () => ({}),
    reporter: { info: () => {}, error: () => {} }
  };
}

async function testGenerateNodeIdShape() {
  // ID format: `mysql__<UpperCamel>__<id>`; type: `Mysql<Name>`
  const nodes = [];
  await createMysqlNodes(
    {
      name: `country`,
      idFieldName: `Code`,
      __sqlResult: [
        {
          Code: `USA`,
          Name: `United States`,
          Population: 278357000,
          Continent: `North America`
        }
      ]
    },
    [],
    reporterArgs(nodes)
  );
  assert.strictEqual(nodes.length, 1);
  const node = nodes[0];
  assert.strictEqual(node.id, `mysql__Country__USA`);
  assert.strictEqual(node.internal.type, `MysqlCountry`);
  assert.strictEqual(node.parent, null);
  assert.strictEqual(node.children.length, 0);
  assert.ok(/^[a-f0-9]{32}$/.test(node.internal.contentDigest));
  assert.strictEqual(node.Code, `USA`);
  assert.strictEqual(node.Name, `United States`);
  assert.strictEqual(node.Population, 278357000);
}

async function testOneToOneManyLinks() {
  const nodes = [];
  const countryQuery = {
    name: `country`,
    idFieldName: `Code`,
    __sqlResult: [{ Code: `USA`, Name: `United States` }]
  };
  const cityQuery = {
    name: `city`,
    idFieldName: `ID`,
    parentName: `country`,
    foreignKey: `CountryCode`,
    __sqlResult: [
      { ID: 1, CountryCode: `USA`, Name: `New York` },
      { ID: 2, CountryCode: `USA`, Name: `Boston` }
    ]
  };
  const args = reporterArgs(nodes);

  await Promise.all([
    createMysqlNodes(countryQuery, [countryQuery, cityQuery], args),
    createMysqlNodes(cityQuery, [countryQuery, cityQuery], args)
  ]);

  const country = nodes.find(n => n.internal.type === `MysqlCountry`);
  const newYork = nodes.find(n => n.internal.type === `MysqlCity` && n.ID === 1);
  const boston = nodes.find(n => n.internal.type === `MysqlCity` && n.ID === 2);

  assert.ok(country);
  // OneToMany: field named after pluralized child table, as ___NODE links
  assert.deepStrictEqual(country.cities___NODE, [
    `mysql__City__1`,
    `mysql__City__2`
  ]);
  // child parent link: singular parent name
  assert.strictEqual(newYork.country___NODE, `mysql__Country__USA`);
  assert.strictEqual(boston.country___NODE, `mysql__Country__USA`);
}

async function testRestrictedFieldsAreRenamed() {
  const nodes = [];
  await createMysqlNodes(
    {
      name: `record`,
      idFieldName: `pk`,
      __sqlResult: [{ pk: 7, id: `sql-value`, fields: [1, 2], parent: `x`, internal: {raw: 1} }]
    },
    [],
    reporterArgs(nodes)
  );
  const node = nodes[0];
  assert.strictEqual(node.id, `mysql__Record__7`);
  assert.strictEqual(node.internal.type, `MysqlRecord`);
  // NOTE (matches original gatsby-source-mysql): a SQL column literally named
  // "id" is overwritten by the idFieldName value in mapSqlResults before the
  // conflict-field renaming, so its original content is not preserved.
  assert.strictEqual(node.mysqlId, 7);
  assert.deepStrictEqual(node.mysqlFields, [1, 2]);
  assert.strictEqual(node.mysqlParent, `x`);
  assert.strictEqual(node.mysqlInternal.raw, 1);
  assert.strictEqual(node.fields, undefined);
  assert.strictEqual(node.parent, null); // parent stays null; raw value renamed
  assert.strictEqual(node.internal.raw, undefined);
  assert.strictEqual(node.mysqlInternal.raw, 1);
}

async function testRemoteImageFieldsWithoutSourceFilesystem() {
  // With remoteImageFieldNames but no gatsby-source-filesystem installed we
  // must fail with an understandable error, not a stack trace.
  let threw = false;
  try {
    await createMysqlNodes(
      {
        name: `actor`,
        idFieldName: `actor_id`,
        remoteImageFieldNames: [`profile_url`],
        __sqlResult: [{ actor_id: 5, profile_url: `https://example.com/a.jpg` }]
      },
      [],
      reporterArgs([])
    );
  } catch (err) {
    threw = true;
    assert.ok(
      /gatsby-source-filesystem/.test(err.message),
      `error should mention gatsby-source-filesystem, got: ${err.message}`
    );
  }
  assert.ok(threw, `expected an error when gatsby-source-filesystem is missing`);
}

(async () => {
  await testGenerateNodeIdShape();
  await testOneToOneManyLinks();
  await testRestrictedFieldsAreRenamed();
  await testRemoteImageFieldsWithoutSourceFilesystem();
  console.log(`ok - all node-creation tests passed`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
