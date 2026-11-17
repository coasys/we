/**
 * The social DNA package: reading it, installing it, and reading back the records of its classes.
 *
 * A package is a WE bundle (`format: "we-bundle"`, see docs/architecture/apps-as-data.md) with one
 * addition: `flows`, a list of `WorkflowDefinition`s (`@we/backend-shared`, workflows.ts). The bundle
 * half installs through the app — Settings → Apps & templates → "Install an app from a file" — which
 * is the path a person takes. Bundles have no field for flows yet, so the flows are installed from
 * Node through the workflow port (`createAd4mBackendPorts(client).workflows.install`), the same port
 * the app's Workflows page writes through. The README documents the format.
 *
 * Records are read straight from the space's links, by each class's flag and property predicates as
 * the package declares them: what is asserted is what is stored, not what a store chose to show.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LinkQuery, Literal } from '@coasys/ad4m';
import { getEntityForDataset } from '@we/backend-ad4m';

import { until } from '../harness.mjs';
import { DNA_PATH } from './context.mjs';

/** The package, parsed, with each class's flag and properties pulled out of its manifest. */
export function readDna(path = DNA_PATH) {
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  const classes = [];
  for (const recordType of bundle.recordTypes ?? []) {
    for (const [name, entity] of Object.entries(recordType.manifest?.entities ?? {})) {
      const properties = entity.properties ?? {};
      const titleField =
        entity.display?.title ??
        Object.keys(properties).find((p) => properties[p].identity) ??
        Object.keys(properties)[0];
      classes.push({
        name,
        flag: entity.flag,
        properties,
        titleField,
        titlePredicate: properties[titleField]?.predicate,
        extractable: Boolean(entity.extractable),
      });
    }
  }
  return {
    bundle,
    name: bundle.name,
    classes,
    flows: bundle.flows ?? [],
    byName: (n) => classes.find((c) => c.name === n),
  };
}

export const DNA = readDna();

/** The perspective behind a shared space, as one account holds it. */
export async function spacePerspective(client, sharedUrl) {
  return until(async () => (await client.perspective.all()).find((p) => p.sharedUrl === sharedUrl), Boolean, {
    timeout: 120_000,
    what: `the perspective of ${sharedUrl}`,
  });
}

/** A link target as its value: a literal decoded, anything else as it is. */
export const valueOf = (target) => {
  try {
    return Literal.fromUrl(target).get();
  } catch {
    return target;
  }
};

/** Every record of a package class in a perspective: `{ id, title, values }`, values by field name. */
export async function records(perspective, cls) {
  const flagged = await perspective.get(new LinkQuery({ predicate: cls.flag.predicate, target: cls.flag.value }));
  const ids = [...new Set(flagged.map((l) => l.data.source))];
  return Promise.all(
    ids.map(async (id) => {
      const links = await perspective.get(new LinkQuery({ source: id }));
      const values = {};
      for (const [field, prop] of Object.entries(cls.properties)) {
        const link = links.filter((l) => l.data.predicate === prop.predicate).at(-1);
        if (link) values[field] = valueOf(link.data.target);
      }
      return { id, title: String(values[cls.titleField] ?? ''), values };
    }),
  );
}

/** Whether a link joins two nodes, in either direction, through any predicate. */
export async function linked(perspective, a, b) {
  const [out, back] = await Promise.all([
    perspective.get(new LinkQuery({ source: a, target: b })),
    perspective.get(new LinkQuery({ source: b, target: a })),
  ]);
  return out.length + back.length > 0;
}

/** The SHACL shape names the perspective holds. */
export async function shaclNames(perspective) {
  return ((await perspective.getShaclNames()) ?? []).map(String);
}

/**
 * Who the space counts as running it, read from its records: the admin role's grants, the Space
 * record's author, and the person `did` speaks for — what the app's `canAdministerSpace` compares.
 */
export async function administration(ports, perspective, did) {
  const read = async (entity, where) =>
    getEntityForDataset(entity, perspective)
      .findAll(perspective, where ? { where } : undefined)
      .catch((e) => `unreadable: ${e.message}`);
  const grants = await read('RoleGrant', { role: 'admin' });
  const spaces = await read('Space');
  return {
    me: did,
    mePerson: (await ports.persons?.personOf(did).catch(() => null)) ?? null,
    adminHolders: Array.isArray(grants) ? grants.filter((g) => !g.revokedAt).map((g) => g.agent) : grants,
    perspective: { uuid: perspective.uuid, sharedUrl: perspective.sharedUrl },
    spaces: Array.isArray(spaces) ? spaces.map((s) => ({ uuid: s.uuid, url: s.url, author: s.author })) : spaces,
  };
}

/**
 * Installs the package's bundle through Settings, setting up `who`'s space named `spaceName` for it.
 * Ends back in the space. Asserts the install prompt, and the toast that says it is done. When the
 * prompt never offers the space, the error carries {@link administration} for `perspective`.
 */
export async function installDnaThroughUi(who, spaceName, perspective, path = DNA_PATH) {
  const { page } = who;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Apps & templates' }).click();
  // The modal's `role=dialog` is in its shadow root and its content is slotted, so the content is not
  // a DOM descendant of the dialog: the prompt is found from its `we-modal` host.
  const dialog = page.locator('we-modal').filter({ hasText: `Install ${DNA.name}?` });
  const space = dialog.getByRole('checkbox', { name: spaceName });
  // The checklist offers only the spaces this agent runs. Just after a space is made, the app may not
  // yet know who made it, and offers none; the prompt is asked again until it lists this space.
  const deadline = Date.now() + 150_000;
  const input = page.locator('we-file-upload input[type=file]').first();
  for (let tries = 1; ; tries++) {
    // Cleared first: choosing the file the input already holds fires no change, and asks nothing.
    await input.setInputFiles([]);
    await input.setInputFiles(path);
    await dialog.waitFor({ timeout: 60_000 });
    if (
      await space.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      )
    )
      break;
    if (Date.now() > deadline) {
      const facts = await administration(who.ports, perspective, who.did);
      throw new Error(
        `the install prompt never offered the space "${spaceName}" (${tries} tries): ${JSON.stringify(facts)}`,
      );
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  }
  if (!(await space.isChecked())) await space.click();
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByText(`“${DNA.name}” installed`).first().waitFor({ timeout: 120_000 });
  // Settings is a page, not a dialog: Escape does not leave it. The space's button on the rail does.
  await page.getByRole('button', { name: spaceName, exact: true }).first().click();
  await page.getByRole('tree', { name: 'This space' }).waitFor({ timeout: 60_000 });
}

/** Installs the package's flows into a space through the workflow port, and checks they read back. */
export async function installFlows(ports, perspective) {
  // A flow's evidence names a relation of its record ("responses" of a Task). The port resolves it from
  // the shapes declared in this process — the app declares a space's shapes when it opens the space
  // (ShapeStore), and this process declares the package's, under the same module id the app uses.
  for (const recordType of DNA.bundle.recordTypes ?? []) {
    ports.schemas.declareInDataset(perspective, recordType.manifest, { moduleId: `shape/${recordType.name}` });
  }
  for (const flow of DNA.flows) await ports.workflows.install(perspective, flow);
  const listed = await ports.workflows.list(perspective);
  for (const flow of DNA.flows) {
    assert.ok(
      listed.some((w) => w.name === flow.name),
      `flow ${flow.name} is listed after install (listed: ${listed.map((w) => w.name).join(', ')})`,
    );
  }
}
