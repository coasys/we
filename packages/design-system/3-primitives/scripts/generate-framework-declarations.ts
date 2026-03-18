/// <reference types="node" />

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Framework {
  name: string;
  moduleName?: string;
  namespace?: string;
}

interface ComponentProperty {
  name: string;
  type: string;
  default?: string;
}

interface Component {
  className: string;
  tagName: string;
  properties: Record<string, ComponentProperty>;
  customTypes: Set<string>;
  filePath: string;
}

interface CustomElementsManifest {
  modules: Array<{
    declarations?: Array<{
      kind: string;
      customElement?: boolean;
      tagName?: string;
      members?: Array<{
        kind: string;
        name: string;
        attribute?: boolean;
        type?: { text?: string };
        default?: string;
        readonly?: boolean;
      }>;
    }>;
    path?: string;
  }>;
}

const FRAMEWORKS = {
  global: [{ name: 'global' }],
  react: [
    { name: 'react', moduleName: 'react' },
    { name: 'react-jsx', moduleName: 'react/jsx-runtime' },
    { name: 'react-jsxdev', moduleName: 'react/jsx-dev-runtime' },
  ],
  svelte: [{ name: 'svelte', namespace: 'svelteHTML' }],
  solid: [{ name: 'solid', moduleName: 'solid-js' }],
  // { name: 'preact', moduleName: 'preact' },
  // { name: 'preact-jsx', moduleName: 'preact/jsx-runtime' },
  // { name: 'vue', moduleName: '@vue/runtime-dom' },
  // { name: 'qwik', moduleName: '@builder.io/qwik' },
};

function indent(level: number): string {
  return ' '.repeat(level * 2); // 2 spaces per indentation level
}

function extractComponentsFromCustomElementsManifest(cemData: CustomElementsManifest): Component[] {
  return cemData.modules
    .filter((module) => module.declarations)
    .flatMap((module) => {
      const baseName = module.path ? path.basename(module.path, '.ts') : '';

      return (module.declarations || [])
        .filter((declaration) => declaration.kind === 'class' && declaration.customElement && declaration.tagName)
        .map((declaration) => {
          // Extract properties
          const properties: Record<string, ComponentProperty> = {};
          const customTypes = new Set<string>();

          declaration.members
            ?.filter((member) => member.kind === 'field' && !member.name.startsWith('_'))
            .forEach((member) => {
              // Clean up type name
              let typeName = member.type?.text || 'any';
              if (typeName.includes(' | undefined')) typeName = typeName.replace(' | undefined', '');

              // Keep track of custom types needed for declaration
              const isBasicType = ['string', 'boolean', 'number', 'any'].includes(typeName);
              const isReadonly = member.readonly;
              const isFunction = typeName.includes('=>');
              if (!isReadonly && !isFunction && !isBasicType) customTypes.add(typeName);

              // Store the property
              properties[member.name] = { name: member.name, type: typeName, default: member.default };
            });

          return {
            className: baseName,
            tagName: declaration.tagName || '',
            properties,
            customTypes,
            filePath: module.path || '',
          };
        });
    });
}

function generateComponentProps(component: Component, typesPath: string, framework?: Framework): string {
  return [
    // Map properties from the component
    ...Object.entries(component.properties).map(([name, prop]) => {
      let typeDefinition = prop.type;

      // Check if it's a custom type that should be imported
      if (component.customTypes.has(typeDefinition)) typeDefinition = `import('${typesPath}').${typeDefinition}`;

      return `${indent(4)}${name}?: ${typeDefinition};`;
    }),

    // Add standard properties
    `${indent(4)}key?: string | number;`,
    `${indent(4)}ref?: HTMLElement;`,
    `${indent(4)}slot?: string | number;`,
    `${indent(4)}id?: string;`,
    `${indent(4)}class?: string;`,
    `${indent(4)}style?: Record<string, any>;`,
    `${indent(4)}styles?: Record<string, any>;`,
    `${indent(4)}children?: any;`,

    // Add DOM event handlers
    `${indent(4)}onClick?: (event: MouseEvent) => void;`,
    `${indent(4)}onInput?: (event: InputEvent) => void;`,
    `${indent(4)}onChange?: (event: Event) => void;`,
    `${indent(4)}onFocus?: (event: FocusEvent) => void;`,
    `${indent(4)}onBlur?: (event: FocusEvent) => void;`,
    `${indent(4)}onKeyDown?: (event: KeyboardEvent) => void;`,
    `${indent(4)}onKeyUp?: (event: KeyboardEvent) => void;`,
    `${indent(4)}onSubmit?: (event: Event) => void;`,

    // Add prop: namespace for Solid.js to explicitly set object properties
    ...(framework?.name === 'solid'
      ? [
          `${indent(4)}'prop:hoverProps'?: Record<string, any>;`,
          `${indent(4)}'prop:activeProps'?: Record<string, any>;`,
          `${indent(4)}'prop:focusProps'?: Record<string, any>;`,
          `${indent(4)}'prop:disabledProps'?: Record<string, any>;`,
        ]
      : []),
  ].join('\n');
}

function buildDeclarationContent(framework: Framework, content: string, tagName?: string): string {
  // Determine module or global declaration
  const declarationType = framework.moduleName ? `declare module '${framework.moduleName}'` : 'declare global';

  // Format the property content based on whether it's for an individual component file or part of an index
  const propertyContent = tagName ? [`'${tagName}': {`, content, `${indent(3)}};`].join('\n') : `${content};`;

  // Determine the prefix for the JSX namespace based on the framework
  const reactRuntime = framework.name.split('-')[0] === 'react';

  // Create the declaration lines
  const solidImport = ["import 'solid-js'", ''];

  const intrinsicElementsDeclaration = [
    `${declarationType} {`,
    `${indent(1)}namespace ${framework.namespace || 'JSX'} {`,
    `${indent(2)}interface IntrinsicElements ${reactRuntime ? 'extends React.JSX.IntrinsicElements ' : ''}{`,
    `${indent(3)}${propertyContent}`,
    `${indent(2)}}`,
  ];

  const fixForReactChildren = [
    '',
    `${indent(2)}// Added to fix declaration conflict with the children prop in React`,
    `${indent(2)}interface ElementChildrenAttribute {`,
    `${indent(3)}children: React.ReactNode;`,
    `${indent(2)}}`,
  ];

  const closingBrackets = [`${indent(1)}}`, `}`];

  const emptyModuleExport = ['', 'export {};'];

  const declaration = [
    ...(framework.name === 'solid' ? solidImport : []),
    ...intrinsicElementsDeclaration,
    ...(reactRuntime ? fixForReactChildren : []),
    ...closingBrackets,
    ...(framework.name === 'svelte' ? emptyModuleExport : []),
    '',
  ];

  return declaration.join('\n');
}

async function generateComponentDeclaration(component: Component, framework: Framework) {
  const componentProps = generateComponentProps(component, `../../../types`, framework);
  const declaration = buildDeclarationContent(framework, componentProps, component.tagName);

  // Resolve output path relative to script location
  const outputPath = path.resolve(
    __dirname,
    '../dist/types',
    framework.name,
    'components',
    `${component.className}.d.ts`,
  );
  await fs.writeFile(outputPath, declaration);
}

async function generateFrameworkIndexFile(components: Component[], framework: Framework): Promise<void> {
  const componentsProps = components
    .map((component) =>
      [`'${component.tagName}': {`, generateComponentProps(component, `../../types`, framework), `${indent(3)}}`].join(
        '\n',
      ),
    )
    .join(`;\n${indent(3)}`); // Add indentation and semicolon between components

  const declaration = buildDeclarationContent(framework, componentsProps);

  // Resolve output path relative to script location
  const outputPath = path.resolve(__dirname, '../dist/types', framework.name, 'index.d.ts');
  await fs.writeFile(outputPath, declaration);
}

async function generateFrameworkDeclarations(): Promise<void> {
  try {
    // Load source files - resolve path relative to script location
    const cemPath = path.resolve(__dirname, '../custom-elements.json');
    const cemData = await fs.readFile(cemPath, 'utf8').then((data) => JSON.parse(data) as CustomElementsManifest);

    // Extract components from the custom-elements.json manifest
    const components = extractComponentsFromCustomElementsManifest(cemData);

    console.log(`Found ${components.length} components`);
    console.log('Generating type declarations');

    // Process all frameworks in parallel
    await Promise.all(
      Object.values(FRAMEWORKS)
        .flat()
        .map(async (framework) => {
          // Create directory - resolve path relative to script location
          const frameworkDir = path.resolve(__dirname, '../dist/types', framework.name, 'components');
          await fs.mkdir(frameworkDir, { recursive: true });

          // Generate individual component declarations
          await Promise.all(components.map(async (component) => generateComponentDeclaration(component, framework)));

          // Generate index file declaration
          await generateFrameworkIndexFile(components, framework);

          console.log(`Type declarations generated for ${framework.name}`);
        }),
    );

    console.log('All type declarations generated successfully!');
  } catch (err) {
    console.error('Error generating types:', err);
    process.exit(1);
  }
}

// Run the generator
generateFrameworkDeclarations();

export default generateFrameworkDeclarations;
