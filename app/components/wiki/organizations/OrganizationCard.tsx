import type { OrganizationListItem } from '~/types/organization';

interface OrganizationCardProps {
  organization: OrganizationListItem;
  onClick: (organization: OrganizationListItem) => void;
}

export function OrganizationCard({ organization, onClick }: OrganizationCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({
            collection: 'organization',
            documentId: organization.id,
            title: organization.name,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(organization)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(organization);
        }
      }}
      className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
            {organization.name}
          </span>
        </div>
        {organization.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {organization.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
