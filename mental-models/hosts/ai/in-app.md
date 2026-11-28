# In-app AI

The app shell uses a model in two places: the template editor's chat and the shape wizard. The editor first gives a request to an agent that the backend runs. When the backend has no agent for it, the editor runs its own loop on the backend's language model. Each editor chat is stored as ordinary WE records in the person's root dataset.

**Why:** A backend agent writes the stored record, as the editor's own save does, so the editor hands over only a template that has a stored record and is not read-only (`sendViaAgent` in `EditorStore.tsx`). The editor asks the backend again when the panel opens, because models are added and changed in Settings while the app runs. A chat is a `CollectionBlock` with `TextBlock` children, so who said what is a fact about the record, and every reader understands a chat as a collection (`shared/editorChats.ts`).

**Parent:** [AI](README.md)

<details><summary>How it works</summary>

1. `EditorStore.send(text)` runs `sendViaAgent`, and runs `sendViaNode` if that answers false.
2. `sendViaAgent` calls `backendPorts().agents.run({dataset, turns, about: {entity: 'Template', id}, mayEdit: true})`. `agentTurns(messages, text)` builds the turns: it leaves out the panel's own notes, the request still `sending` and the reply still `streaming`, and puts the request last. An `AgentUnavailableError` sends the request to `sendViaNode`.
3. `sendViaNode` runs `prepareTemplateRequest` and `runEditSession` ([Agent tools](agent-tools.md)) over `languageModel.converse`.
4. The assistant is available when the language model port has `converse` and answers `available()`. `refreshAssistant` asks only after the [first screen](../boot/first-screen.md) is open, and again each time the panel opens.
5. A chat is a `CollectionBlock` of kind `chat` (`CHAT_KIND`) with the template's id as its `slug`. A model's message is `generatedBy` a `ModelRun` of kind `chat`. Only the editor reads chats.
6. `ShapeStore.generateShapeDraft(description)` calls the language model with one forced tool, `define_model`, that fills a `ShapeDraft`. The draft goes through the same checks as one that a person builds, the errors go back to the model for a limited number of repair turns, and the result goes to the wizard for the person to review.

</details>

<details><summary>Where in the code</summary>

- [EditorStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/EditorStore.tsx): `send`, `sendViaAgent`, `sendViaNode`, `refreshAssistant`, `assistantAvailable`.
- [agentTurns.ts](../../../packages/app-shell/src/shared/agentTurns.ts): `agentTurns`; [editorChats.ts](../../../packages/app-shell/src/shared/editorChats.ts): `CHAT_KIND`.
- [shapeGeneration.ts](../../../packages/app-shell/src/shared/ai/shapeGeneration.ts): `generateShapeDraft`, `define_model`; [ShapeStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ShapeStore.tsx).
- [agents.ts](../../../packages/backend-system/shared/src/agents.ts): `AgentTurn`, `AgentRunRequest`, `AgentUnavailableError`.
- The editor as a surface: [Editor](../../interface/templates/editor.md); the shape wizard: [Shapes](../../data/spaces/shapes.md); the block and `ModelRun` entities: [Entities](../../data/entities/README.md).

</details>
