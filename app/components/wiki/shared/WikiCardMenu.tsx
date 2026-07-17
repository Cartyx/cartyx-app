import { OverflowMenu } from '~/components/shared/OverflowMenu';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

interface WikiCardMenuProps {
  collection: string;
  documentId: string;
  /** aria-label for the trigger, e.g. "Character actions". */
  label: string;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * The overflow menu for a wiki card. One line per card: all of the
 * permission/target logic lives in useWikiCardActions, and OverflowMenu
 * renders nothing when no actions qualify.
 */
export function WikiCardMenu(props: WikiCardMenuProps) {
  const { menuItems } = useWikiCardActions(props);
  return <OverflowMenu items={menuItems} label={props.label} />;
}
