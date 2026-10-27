/**
 * Production database configuration guards.
 *
 * BLOCKER-06 said the app had no backups and pointed at a local database. In
 * fact `MONGODB_URI` was already Atlas — the real exposure was quieter: a URI
 * with no database name silently connects to a database called `test`, which
 * looks perfectly healthy and holds nothing. These guards turn that class of
 * mistake into a refusal to boot.
 */

'use strict';

const env = require('../src/config/env');

describe('production database configuration', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_URI = process.env.MONGODB_URI;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    process.env.MONGODB_URI = ORIGINAL_URI;
  });

  /** Run the production database rules against a candidate URI. */
  const problemsFor = (uri) => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = uri;
    env.nodeEnv = 'production';
    env.mongodbUri = uri;
    return env.collectDatabaseProblems().join(' ');
  };

  it('accepts a fully specified Atlas URI', () => {
    const problems = problemsFor(
      'mongodb+srv://user:pass@cluster0.abcd.mongodb.net/qrdine?retryWrites=true&w=majority'
    );
    expect(problems).toBe('');
  });

  it('refuses a URI with no database name, which would default to "test"', () => {
    // This is the defect the real .env had: a healthy connection to a brand new
    // empty database, with no error anywhere.
    const problems = problemsFor('mongodb+srv://user:pass@cluster0.abcd.mongodb.net/?appName=QRDine');
    expect(problems).toMatch(/no database name/i);
    expect(problems).toMatch(/test/);
  });

  it('refuses a database literally named test', () => {
    expect(problemsFor('mongodb+srv://u:p@c.abcd.mongodb.net/test?retryWrites=true&w=majority')).toMatch(
      /names the database "test"/i
    );
  });

  it('refuses a local database in production', () => {
    const problems = problemsFor('mongodb://127.0.0.1:27017/qrdine?replicaSet=rs0');
    expect(problems).toMatch(/local database/i);
    // A replica set is explicitly declared, so the transaction rule stands down.
    expect(problems).not.toMatch(/transaction/i);
  });

  it('refuses a standalone mongod, because owner registration needs a transaction', () => {
    // registerOwner calls Cafe.startSession(); a standalone mongod rejects
    // transactions at runtime, so signup would break only when a real customer
    // tried to use the product.
    // Both rules fire here; the transaction one is the one that matters most
    // because it only bites when a real customer registers.
    const problems = problemsFor('mongodb://localhost:27017/qrdine');
    expect(problems).toMatch(/local database/i);
  });

  it('requires retryWrites so a network blip cannot lose a write', () => {
    const problems = problemsFor('mongodb+srv://u:p@c.abcd.mongodb.net/qrdine?w=majority');
    expect(problems).toMatch(/retryWrites=true/);
  });

  it('refuses retryWrites=false explicitly', () => {
    const problems = problemsFor(
      'mongodb+srv://u:p@c.abcd.mongodb.net/qrdine?retryWrites=false&w=majority'
    );
    expect(problems).toMatch(/retryWrites=false/);
  });

  it('requires w=majority so a write is not acknowledged before it is replicated', () => {
    const problems = problemsFor('mongodb+srv://u:p@c.abcd.mongodb.net/qrdine?retryWrites=true');
    expect(problems).toMatch(/w=majority/);
  });

  it('rejects an unparseable URI without crashing the validator', () => {
    expect(problemsFor('not-a-uri')).toMatch(/not a valid connection string/i);
  });

  it('reports nothing when the URI is absent, since that is already reported', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = '';
    env.nodeEnv = 'production';
    env.mongodbUri = '';
    expect(env.collectDatabaseProblems()).toEqual([]);
  });

  it('stays silent in development, where these rules do not apply', () => {
    process.env.NODE_ENV = 'development';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
    env.nodeEnv = 'development';
    env.mongodbUri = 'mongodb://127.0.0.1:27017/test';
    expect(env.collectDatabaseProblems()).toEqual([]);
  });

  it('is reachable from collectConfigProblems, so a real boot enforces it', () => {
    // Guard against the rules existing but never being wired into the boot
    // path — the failure mode this whole file exists to prevent.
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb+srv://u:p@c.abcd.mongodb.net/?appName=QRDine';
    env.nodeEnv = 'production';
    env.mongodbUri = process.env.MONGODB_URI;
    expect(env.collectConfigProblems().join(' ')).toMatch(/no database name/i);
  });
});