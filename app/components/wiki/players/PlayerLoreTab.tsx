import React, { useState } from 'react';
import { useLinkedLore, useDeleteLore } from '~/hooks/useLore';
import { LoreList } from '~/components/wiki/lore/LoreList';
import { LoreModal } from '~/components/wiki/lore/LoreModal';
import { LoreViewModal } from '~/components/wiki/lore/LoreViewModal';

interface PlayerLoreTabProps {
  campaignId: string;
  playerId: string;
  canManage: boolean;
}

export function PlayerLoreTab({ campaignId, playerId, canManage }: PlayerLoreTabProps) {
  const { lore } = useLinkedLore(campaignId, 'player', playerId);
  const { remove } = useDeleteLore();

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  return (
    <>
      <LoreList
        lore={lore}
        canManage={canManage}
        onAdd={() => setAddOpen(true)}
        onOpen={setViewId}
        onEdit={setEditId}
        onRemove={(id) => remove({ id, campaignId })}
      />

      {addOpen && (
        <LoreModal
          isOpen
          onClose={() => setAddOpen(false)}
          campaignId={campaignId}
          initialLinks={[{ kind: 'player', id: playerId }]}
        />
      )}

      {editId && (
        <LoreModal isOpen onClose={() => setEditId(null)} campaignId={campaignId} loreId={editId} />
      )}

      {viewId && (
        <LoreViewModal
          isOpen
          onClose={() => setViewId(null)}
          loreId={viewId}
          campaignId={campaignId}
        />
      )}
    </>
  );
}
