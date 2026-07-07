// Element-type -> React component registry.
// Extending the UI = add a component and register it here; unknown types
// render a graceful fallback instead of crashing.
import MarkdownElement from "./MarkdownElement.jsx";
import ChartElement from "./ChartElement.jsx";
import DownloadElement from "./DownloadElement.jsx";
import FilterPanelElement from "./FilterPanelElement.jsx";
import TableElement from "./TableElement.jsx";
import StatsElement from "./StatsElement.jsx";

export const ELEMENT_REGISTRY = {
  markdown: MarkdownElement,
  chart: ChartElement,
  download: DownloadElement,
  filter_panel: FilterPanelElement,
  table: TableElement,
  stats: StatsElement,
};

export function registerElement(type, component) {
  ELEMENT_REGISTRY[type] = component;
}
