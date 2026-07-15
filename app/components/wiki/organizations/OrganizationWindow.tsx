import type React from 'react';
import { Pencil, MapPin } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OrganizationData } from '~/types/organization';
import type { PictureCrop } from '~/types/character';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { useMembershipsForOrg } from '~/hooks/useOrganizations';
import { EntityQuestsTab } from '~/components/shared/EntityQuestsTab';

function getCropStyle(crop: PictureCrop): React.CSSProperties {
  const centerX = (crop.x + crop.width / 2) * 100;
  const centerY = (crop.y + crop.height / 2) * 100;
  const scale = 1 / crop.width;
  return {
    objectPosition: `${centerX}% ${centerY}%`,
    transform: `scale(${scale})`,
  };
}

interface OrganizationWindowProps {
  organization: OrganizationData;
  onEdit?: () => void;
}

export function OrganizationWindow({ organization, onEdit }: OrganizationWindowProps) {
  const { memberships } = useMembershipsForOrg(organization.campaignId, organization.id);
  const showMeta = organization.tags.length > 0 || (organization.canEdit && !!onEdit);

  return (
    <div className="flex flex-col h-full" data-testid="organization-window">
      {showMeta && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.05] shrink-0">
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {organization.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
          </div>
          {organization.canEdit && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
              aria-label="Edit organization"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 min-h-0 space-y-5">
        {/* Images gallery */}
        {organization.images.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Images</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {organization.images.map((image, idx) => (
                <div key={idx} className="flex flex-col gap-1">
                  <div className="w-full aspect-square overflow-hidden rounded-lg border border-white/[0.08]">
                    <img
                      src={image.url}
                      alt={image.caption || `Organization image ${idx + 1}`}
                      className="w-full h-full object-cover"
                      style={image.crop ? getCropStyle(image.crop) : undefined}
                    />
                  </div>
                  {image.caption && (
                    <p className="text-[10px] text-slate-500 text-center leading-tight">
                      {image.caption}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public info */}
        {organization.publicInfo && (
          <div className={MARKDOWN_PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{organization.publicInfo}</ReactMarkdown>
          </div>
        )}

        {/* GM-only private info */}
        {organization.privateInfo && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-2">
              GM Only
            </p>
            <div className={MARKDOWN_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{organization.privateInfo}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Members */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            Members
          </p>
          {memberships.length === 0 ? (
            <p className="text-xs text-slate-500">No members yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {memberships.map((m) => (
                <div
                  key={m.id}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200 truncate">
                      {m.memberLabel || 'Unknown'}
                    </span>
                    {m.title && (
                      <span className="text-[11px] text-blue-400 shrink-0">{m.title}</span>
                    )}
                  </div>
                  {m.publicNotes && (
                    <div className={`${MARKDOWN_PROSE_CLASSES} mt-1`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.publicNotes}</ReactMarkdown>
                    </div>
                  )}
                  {m.privateNotes && (
                    <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1">
                      <div className={MARKDOWN_PROSE_CLASSES}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.privateNotes}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Locations */}
        {organization.locations.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Locations
            </p>
            <div className="flex flex-col gap-2">
              {organization.locations.map((loc) => (
                <div
                  key={loc.locationId}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                    <MapPin className="h-3.5 w-3.5 text-amber-400" />
                    {loc.label || 'Unknown location'}
                  </div>
                  {loc.publicInfo && (
                    <div className={`${MARKDOWN_PROSE_CLASSES} mt-1`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{loc.publicInfo}</ReactMarkdown>
                    </div>
                  )}
                  {loc.privateInfo && (
                    <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1">
                      <div className={MARKDOWN_PROSE_CLASSES}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{loc.privateInfo}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked Quests */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            Linked Quests
          </p>
          <EntityQuestsTab
            campaignId={organization.campaignId}
            kind="organization"
            id={organization.id}
          />
        </div>
      </div>
    </div>
  );
}
