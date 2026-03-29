import { For, type JSX } from 'solid-js';

export type * from './Table.types';
import type { TableColumn, TableProps } from './Table.types';

interface SolidTableProps extends TableProps {
  renderCell?: (row: Record<string, unknown>, column: TableColumn, index: number) => JSX.Element;
}

export function Table(props: SolidTableProps) {
  const className = () => {
    let cls = 'we-table';
    if (props.striped) cls += ' we-table--striped';
    if (props.bordered) cls += ' we-table--bordered';
    return cls;
  };

  return (
    <table class={className()} style={props.styles}>
      <thead>
        <tr>
          <For each={props.columns}>
            {(col) => <th style={col.width ? { width: col.width } : undefined}>{col.header}</th>}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>
          {(row, rowIndex) => (
            <tr>
              <For each={props.columns}>
                {(col) => (
                  <td>{props.renderCell ? props.renderCell(row, col, rowIndex()) : (row[col.key] as string)}</td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
