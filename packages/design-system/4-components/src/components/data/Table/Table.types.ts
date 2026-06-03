export interface TableColumn {
  key: string;
  header: string;
  width?: string;
}

export interface TableProps {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  striped?: boolean;
  bordered?: boolean;
  styles?: Record<string, string | number>;
}
