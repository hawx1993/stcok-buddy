import { useVirtualizer } from '@tanstack/react-virtual';
import { LoaderCircle, MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import type { ConversationSummary } from '../../../shared/types';
import cx from '../../../shared/cx';
import type { IConversationGroup } from './conversation-groups';
import styles from '../index.module.scss';

type TConversationListRow =
  | { type: 'group'; key: string; label: string }
  | { type: 'conversation'; key: string; conversation: ConversationSummary };

interface IConversationListProps {
  conversationGroups: IConversationGroup[];
  activeConversationId?: string;
  respondingConversationId?: string;
  conversationMenuId?: string;
  editingConversationId?: string;
  editingTitle: string;
  onEditingTitleChange(title: string): void;
  onSelectConversation(item: ConversationSummary): void;
  onToggleConversationMenu(id: string): void;
  onStartRename(item: ConversationSummary): void;
  onSaveRename(id: string): void;
  onDeleteConversation(id: string): void;
  onMoveGlow(event: React.MouseEvent<HTMLElement>): void;
}

interface IConversationRowProps extends Omit<IConversationListProps, 'conversationGroups'> {
  item: ConversationSummary;
}

function flattenConversationRows(groups: IConversationGroup[]): TConversationListRow[] {
  return groups.flatMap((group) => [
    { type: 'group' as const, key: `group-${group.label}`, label: group.label },
    ...group.conversations.map((conversation) => ({
      type: 'conversation' as const,
      key: `conversation-${conversation.id}`,
      conversation,
    })),
  ]);
}

export function ConversationList(props: IConversationListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenConversationRows(props.conversationGroups), [props.conversationGroups]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) => (rows[index]?.type === 'group' ? 30 : 31),
    overscan: 12,
  });

  return (
    <div className={styles['sidebar-list']} ref={listRef}>
      {rows.length ? (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={styles['conversation-virtual-row']}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.type === 'group' ? (
                  <h2 className={styles['conversation-group-title']}>{row.label}</h2>
                ) : (
                  <ConversationRow {...props} item={row.conversation} />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles['empty-list']}>无匹配对话</div>
      )}
    </div>
  );
}

const ConversationRow = memo(function ConversationRow({
  item,
  activeConversationId,
  respondingConversationId,
  conversationMenuId,
  editingConversationId,
  editingTitle,
  onEditingTitleChange,
  onSelectConversation,
  onToggleConversationMenu,
  onStartRename,
  onSaveRename,
  onDeleteConversation,
  onMoveGlow,
}: IConversationRowProps) {
  const isResponding = respondingConversationId === item.id;
  const isEditing = editingConversationId === item.id;
  const isMenuOpen = conversationMenuId === item.id;

  return (
    <div
      onMouseMove={onMoveGlow}
      className={cx(
        styles['source-item-wrap'],
        activeConversationId === item.id && styles.active,
        isMenuOpen && styles['menu-open'],
        isResponding && styles.responding,
        isEditing && styles.editing,
      )}
    >
      {isEditing ? (
        <div className={styles['rename-row']}>
          <MessageCircle size={17} className={styles['source-icon']} />
          <input
            value={editingTitle}
            onChange={(event) => onEditingTitleChange(event.target.value)}
            onBlur={() => onSaveRename(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSaveRename(item.id);
            }}
            autoFocus
          />
        </div>
      ) : (
        <>
          <button
            className={styles['source-item']}
            onClick={() => onSelectConversation(item)}
            type='button'
          >
            <MessageCircle size={17} className={styles['source-icon']} />
            <span className={styles.label}>{item.title}</span>
            <span className={styles.count}>{item.count}</span>
          </button>
          {isResponding ? (
            <span className={cx(styles['source-more'], styles['source-loading'])} aria-label='AI 正在回答'>
              <LoaderCircle size={16} />
            </span>
          ) : (
            <button
              className={styles['source-more']}
              onClick={(event) => {
                event.stopPropagation();
                onToggleConversationMenu(item.id);
              }}
              type='button'
              aria-label='更多操作'
            >
              <MoreHorizontal size={16} />
            </button>
          )}
          {isMenuOpen ? (
            <div className={styles['conversation-menu']}>
              <button className={styles['conversation-action']} onClick={() => onStartRename(item)} type='button'>
                <Pencil size={15} />
                <span>重命名</span>
              </button>
              <button
                className={cx(styles['conversation-action'], styles.danger)}
                onClick={() => onDeleteConversation(item.id)}
                type='button'
              >
                <Trash2 size={15} />
                <span>删除对话</span>
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});
