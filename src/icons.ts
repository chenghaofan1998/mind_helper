export type IconName = "record" | "search" | "save" | "copy" | "open" | "edit" | "file" | "folder";

const paths: Record<IconName, string> = {
  record: '<path d="M5 3h8l3 3v11H5z"/><path d="M13 3v4h4M8 11h6M8 14h4"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
  save: '<path d="M4 3h10l3 3v11H4z"/><path d="M7 3v5h7V3M7 17v-5h7v5"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
  open: '<path d="M3 6h5l2 2h7v8H3z"/><path d="m8 13 2 2 4-4"/>',
  edit: '<path d="m4 16 1-4L14 3l3 3-9 9-4 1Z"/><path d="m12 5 3 3"/>',
  file: '<path d="M5 3h8l3 3v11H5z"/><path d="M13 3v4h4M8 11h5M8 14h5"/>',
  folder: '<path d="M3 5h6l2 2h6v9H3z"/>',
};

export function icon(name: IconName): string {
  return `<svg class="icon icon-${name}" aria-hidden="true" viewBox="0 0 20 20">${paths[name]}</svg>`;
}
