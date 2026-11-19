# Screenshots for we#531 and we#532

All shots come from the app-shell browser harness (`packages/app-shell/tests/browser/run.mjs`): headless Chrome, the real schema taken from `bundles/coasys.bundle.json` at that commit, under the Coasys Glow theme, at devicePixelRatio 2. The harness viewport was 1280 px wide, and each shot is cropped to the mounted surface's width with the empty bottom trimmed. BEFORE = base a8f4a1eac; AFTER = the PR head. Before and after use the same scenario and the same fixture stores. Store data is fixture data, not a live AD4M space. The temporary cases and scenarios are in shot-cases.tgz (tracked.patch + untracked files).

- we532-tree-before.png — base a8f4a1eac. The Coasys space tree (bundle section with `openRows` persist `coasys.tree.open`), 320 px wide, every group open. Top level: Feed, Calls, Workflows (with Review under it), People, Social DNA (This space / Other apps / Built in + Blocks / Policy), Templates, Themes. Scenario `shot:tree` = the existing `coasys:tree-dna` with #532's flow and template fixture added on base too, and the height raised to 1500 px.
- we532-tree-after.png — head a0dd41d47. Same scenario. Top level: Feed, Calls, Flows (count 2, no caret), People, Social DNA → Models (Hive, Question conv://), Flows (Review 2, +), Templates (Coasys space ✓★, Our layout, +), Built in (+ Blocks → Task), Policy (2 rules), then Themes. Policy is fully visible.
- we532-dna-page-before.png — base. The Social DNA page: the `/dna` route from the bundle, 1000 px wide, `templateSegments ['dna']`, no focus (= "all"). Sections: This space, Other apps, Built in, Blocks, Policy. Same fixture as the tree.
- we532-dna-page-after.png — head. Same page: Models (Hive, Question), Flows (Review · 2 records), Templates (Coasys space outlined + starred, Our layout), Built in, Blocks, Policy.
- we531-flows-before.png — base a8f4a1eac. The flows page: the `/workflows` route from the bundle, 1100 px wide, flow "Review" (Draft → Review → Done, entities TaskBlock) open, with 4 records. All four rows read "Untitled".
- we531-flows-after.png — head 613ef5618. Same page and records. Rows read "Ship the flows docs" / "Release notes for 0.12" / "Fix the tree caret on Safari", each with "Task in Review · at <step>". The nameless record (`literal://task-42ab9f`) reads "Task 42ab9f".

Differences from the real app:
- All store data is a fixture: the space's classes, the flows, the templates, the policy sentences and the records.
- In the flows shots, `workflowStore.open` is built with the real `editorView` + `recordView` from `@shared/workflowViews` at each commit. The subject passed to `recordView` is supplied by the scenario rather than looked up by the real WorkflowStore:
  - base: `''` for every record. This is the title the old store produced when its lookup missed (the cause of the "Untitled" rows). On base, a record that the old lookup did find would have shown its name.
  - head: `{ title, entity: 'TaskBlock' }`, as the new store produces once the record is read.
- The crumb on the #531 shots says "Workflows" because #531 does not include #532's rename to "Flows".
- The tree is shown without the rest of the app chrome. The flows and DNA pages are shown without the tree beside them.
- Headless Chrome draws no scrollbars.
