import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import {
  useLocationTypes,
  useCreateLocationType,
  useDeleteLocationType,
} from '~/hooks/useLocationTypes';

interface LocationTypeManagerProps {
  campaignId: string;
}

export function LocationTypeManager({ campaignId }: LocationTypeManagerProps) {
  const { locationTypes } = useLocationTypes(campaignId);
  const { create, isLoading: isCreating } = useCreateLocationType();
  const { remove } = useDeleteLocationType();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    const result = await create({ campaignId, name: trimmed });
    if (result) {
      setNewName('');
    } else {
      setError('Failed to add type');
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const result = await remove({ id, campaignId });
    if (!result) {
      setError('Cannot delete: type may be in use');
    }
  };

  return (
    <div className="p-3 space-y-2">
      <h4 className="font-sans font-bold text-[10px] text-slate-500 uppercase tracking-wider">
        Manage Location Types
      </h4>

      {error && <p className="text-[10px] text-rose-400 font-semibold">{error}</p>}

      <div className="flex flex-wrap gap-1">
        {locationTypes.map((lt) => (
          <span
            key={lt.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-bold text-[9px] tracking-tight capitalize"
          >
            {lt.name}
            {!lt.isDefault && (
              <button
                type="button"
                onClick={() => handleDelete(lt.id)}
                className="text-violet-400/50 hover:text-rose-400 transition-colors"
                aria-label={`Delete ${lt.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="New type name"
          className="flex-1 bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 font-sans font-semibold text-[10px] text-white outline-none focus:border-blue-500/50 transition-colors placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isCreating || !newName.trim()}
          className="flex items-center justify-center h-6 w-6 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Add type"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
