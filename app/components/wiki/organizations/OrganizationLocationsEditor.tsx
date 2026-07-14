import { useState, useMemo, useId } from 'react';
import { X, MapPin } from 'lucide-react';
import { useLocations } from '~/hooks/useLocations';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import type { OrganizationLocationLinkInput } from '~/types/organization';

interface Props {
  campaignId: string;
  value: OrganizationLocationLinkInput[];
  onChange: (links: OrganizationLocationLinkInput[]) => void;
  isGM: boolean;
  disabled?: boolean;
}

export function OrganizationLocationsEditor({
  campaignId,
  value,
  onChange,
  isGM,
  disabled,
}: Props) {
  const uid = useId();
  const { locations } = useLocations(campaignId);
  const [selectedId, setSelectedId] = useState('');

  const locationMap = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const available = useMemo(
    () => locations.filter((l) => !value.some((v) => v.locationId === l.id)),
    [locations, value]
  );

  const addLink = () => {
    if (!selectedId) return;
    if (value.some((v) => v.locationId === selectedId)) return;
    onChange([
      ...value,
      {
        locationId: selectedId,
        label: locationMap.get(selectedId) ?? '',
        publicInfo: '',
        privateInfo: '',
      },
    ]);
    setSelectedId('');
  };

  const updateLink = (locationId: string, patch: Partial<OrganizationLocationLinkInput>) => {
    onChange(value.map((v) => (v.locationId === locationId ? { ...v, ...patch } : v)));
  };

  const removeLink = (locationId: string) => {
    onChange(value.filter((v) => v.locationId !== locationId));
  };

  return (
    <div className="space-y-3" data-testid="organization-locations-editor">
      <span className="block text-xs font-semibold text-slate-400 tracking-wide">Locations</span>

      {value.map((link) => (
        <div
          key={link.locationId}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <MapPin className="h-3.5 w-3.5 text-amber-400" />
              {link.label || locationMap.get(link.locationId) || 'Location'}
            </span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${link.label || 'location'}`}
                onClick={() => removeLink(link.locationId)}
                className="text-slate-500 hover:text-white transition-colors rounded-full p-0.5"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <MarkdownEditor
            label="Public info"
            value={link.publicInfo}
            onChange={(v) => updateLink(link.locationId, { publicInfo: v })}
            placeholder="Public info about this location relationship..."
            disabled={disabled}
            minHeight="120px"
          />
          {isGM && (
            <MarkdownEditor
              label="Private info (GM only)"
              value={link.privateInfo}
              onChange={(v) => updateLink(link.locationId, { privateInfo: v })}
              placeholder="GM-only notes..."
              disabled={disabled}
              minHeight="120px"
            />
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor={`org-loc-${uid}`} className="block text-[11px] text-slate-500 mb-1">
              Add location
            </label>
            <select
              id={`org-loc-${uid}`}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={available.length === 0}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="" className="bg-[#0D1117]">
                {available.length === 0 ? 'No locations' : 'Select location…'}
              </option>
              {available.map((l) => (
                <option key={l.id} value={l.id} className="bg-[#0D1117]">
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={addLink}
            disabled={!selectedId}
            className="flex-shrink-0 px-3 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-white/[0.06] disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
