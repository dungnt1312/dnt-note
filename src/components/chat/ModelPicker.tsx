import { Check, ChevronDown, Settings2 } from "lucide-react";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useUi } from "../../lib/store/uiStore";
import { cn } from "../../lib/utils";
import { Menu, MenuGroup, MenuItem, MenuSeparator } from "../ui/Menu";

/** Chat header dropdown: every saved model of every provider, grouped by provider. */
export function ModelPicker({ compact }: { compact: boolean }) {
  const providers = useSettingsStore((s) => s.providers);
  const activeId = useSettingsStore((s) => s.activeProviderId);
  const selectModel = useSettingsStore((s) => s.selectModel);
  const setSection = useUi((s) => s.setSection);
  const active = providers.find((p) => p.id === activeId) ?? providers[0];

  return (
    <Menu
      align="start"
      width={300}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          title="Chọn model"
          className={cn(
            "inline-flex h-8 min-w-0 items-center gap-1 rounded-sm px-2 font-semibold text-fg transition-colors hover:bg-hover",
            compact ? "text-callout" : "text-headline",
          )}
        >
          <span className="truncate">{active ? active.model || active.name : "Chưa cấu hình AI"}</span>
          <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-fg-tertiary" />
        </button>
      )}
    >
      {providers.map((pr) => (
        <MenuGroup key={pr.id} label={pr.name}>
          {pr.models.length === 0 && (
            <MenuItem disabled icon={<span />} onSelect={() => {}}>
              Chưa có model
            </MenuItem>
          )}
          {pr.models.map((m) => {
            const checked = pr.id === active?.id && m === pr.model;
            return (
              <MenuItem
                key={m}
                checked={checked}
                title={m}
                icon={checked ? <Check size={14} /> : <span />}
                onSelect={() => void selectModel(pr.id, m)}
              >
                {m}
              </MenuItem>
            );
          })}
        </MenuGroup>
      ))}
      {providers.length > 0 && <MenuSeparator />}
      <MenuItem icon={<Settings2 size={14} />} onSelect={() => setSection("settings")}>
        Quản lý model…
      </MenuItem>
    </Menu>
  );
}
