/**
 * Stores fragment — documents all available stores with state keys and action signatures.
 *
 * Hand-maintained: update when stores change (infrequent — only 7 stores).
 */
export const stores = `
## Stores

Stores provide state (readable values) and actions (methods) for dynamic logic in schemas.
Access state with $store and call actions with $action.
For ephemeral/form state, use $localState/$local/$setLocal instead of stores (see Dynamic Logic).

AdamStore:
- State:
  - loading: boolean
  - adamClient: Ad4mClient | undefined
  - me: Agent | undefined
  - mySpaces: array of Space objects
- Actions:
  - navigate(to: string, options?): navigates to a route
  - addNewSpace(space: Space): adds a new space

RouteStore:
- State:
  - currentPath: string (the current route path)
- Actions:
  - navigate(to: string, options?): navigates to a route

ThemeStore:
- State:
  - themes: array of ThemeWithId objects
  - currentTheme: ThemeWithId (the active theme)
- Actions:
  - setThemes(themes: ThemeWithId[]): sets available themes
  - setCurrentTheme(theme: ThemeWithId): sets the active theme

TemplateStore:
- State:
  - templates: array of TemplateSchema objects
  - currentTemplate: TemplateSchema (the active template)
- Actions:
  - updateTemplate(newTemplate: TemplateSchema): updates the current template
  - switchTemplate(newTemplateId: string): switches to another template
  - removeTemplate(): removes the current template
  - saveTemplate(name: string): saves the current template

SpaceStore:
- State:
  - spaceId: string (current space id)
  - perspective: PerspectiveProxy | null
  - space: Partial<Space> (current space object)
  - posts: array of Post objects
  - loading: boolean
- Actions:
  - setSpaceId(id: string): sets the current space id
  - getSpace(): loads space data
  - getPosts(perspective: PerspectiveProxy): loads posts for a space

ModalStore:
- State:
  - createSpaceModalOpen: boolean (whether the create space modal is open)
- Actions:
  - openModal(modal: ModalName): opens a modal
  - closeModal(modal: ModalName): closes a modal

AiStore:
- State:
  - models: array of Model objects
  - tasks: array of AITask objects
- Actions:
  - handleSchemaPrompt(prompt: string): generates a schema from a prompt
`;
