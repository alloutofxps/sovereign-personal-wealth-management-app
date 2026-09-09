/* ===========================================================================
 * YOUR CATEGORIES, AND THE RULES THAT FILE THINGS FOR YOU
 * ---------------------------------------------------------------------------
 * The screen that makes the chart of accounts the person's own rather than
 * ours. Two tabs, because they are two different jobs: what your money is
 * divided into, and what gets sorted without you.
 *
 * Nothing here deletes anything. Archiving keeps every past payment exactly
 * where it was and only stops a category being offered for what comes next —
 * the alternative changes what previous months add up to, which is not a thing
 * a ledger is allowed to do quietly.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '@/core/ledger';
import {
  archiveCategory,
  countEntriesForCategory,
  createCategory,
  createCategoryGroup,
  restoreCategory,
  updateCategory,
  type CategoryNode,
} from '@/data/repositories/categoriesRepo';
import { deleteRule, setRuleActive } from '@/data/repositories/rulesRepo';
import {
  TAG_TABLES,
  deleteTag,
  listTags,
  renameTag,
  type TagRecord,
} from '@/data/repositories/tagsRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { MAX_TAG_LENGTH, describeTagRemoval } from '@/core/taxonomy/tags';
import { useCategoryPicker, useRules, useTaxonomy } from '@/app/taxonomy/useTaxonomy';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  Input,
  List,
  ListItem,
  ListSectionHeader,
  Explain,
  Select,
  Tabs,
} from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

type TabValue = 'taxonomy' | 'rules' | 'tags';

export function CategoryManagerView() {
  const [, navigate] = useRoute();
  const explain = useExplain();
  const [tab, setTab] = useState<TabValue>('taxonomy');
  const taxonomy = useTaxonomy(true);
  const rules = useRules();

  const activeCount = (taxonomy.data?.all ?? []).filter((c) => !c.archivedAt).length;
  const ruleCount = (rules.data ?? []).filter((r) => r.active).length;
  const allTags = useLiveQuery(useCallback(() => listTags(), []), TAG_TABLES);
  const tagCount = (allTags.data ?? []).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="headline text-ink">Categories and tags</h1>
        <Explain topic="tags" label="tags" onOpen={explain.open} />
      </header>

      <Tabs
        label="Categories, rules or tags"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'taxonomy', label: 'Categories', count: activeCount },
          { value: 'rules', label: 'Rules', count: ruleCount },
          { value: 'tags', label: 'Tags', count: tagCount },
        ]}
      />

      {tab === 'taxonomy' ? <TaxonomyTab /> : tab === 'rules' ? <RulesTab /> : <TagsTab />}

      <div>
        <Button variant="secondary" onClick={() => navigate('settings')}>
          Back to settings
        </Button>
      </div>
      {explain.sheet}
    </div>
  );
}

/* ===========================================================================
 * TAGS
 * ---------------------------------------------------------------------------
 * The only place a tag can be renamed or removed. Without it, tags accumulate
 * for ever: a typo made once while filing forty payments would be permanent,
 * and the chip row along the top of the transactions list would slowly fill up
 * with labels nobody meant to keep.
 * ======================================================================== */

function TagsTab() {
  const all = useLiveQuery(useCallback(() => listTags(), []), TAG_TABLES);
  const list = all.data ?? [];
  const [renaming, setRenaming] = useState<TagRecord | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<TagRecord | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!renaming) return;
    setBusy(true);
    try {
      await renameTag(renaming.id, draft);
      toast(`Renamed to ${draft.trim()}. Every payment carrying it now reads the new name.`);
      setRenaming(null);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'That could not be renamed just now.',
        { tone: 'attention' },
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteTag(removing.id);
      toast(`${removing.name} is gone. Every payment it was on is exactly as it was.`);
      setRemoving(null);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'That could not be removed just now.',
        { tone: 'attention' },
      );
    } finally {
      setBusy(false);
    }
  }

  if (list.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-lead text-ink">No tags yet</p>
          <p className="max-w-[38ch] text-caption text-ink-2">
            Choose several payments on the transactions screen and tag them there.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card padding="none">
        <ul className="divide-y divide-line-faint">
          {list.map((tag) => (
            <li key={tag.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-body text-ink">{tag.name}</p>
                <p className="pt-0.5 text-caption text-ink-3">
                  {tag.usedOn === 0
                    ? 'Not on anything yet'
                    : `On ${tag.usedOn} ${tag.usedOn === 1 ? 'payment' : 'payments'}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDraft(tag.name);
                    setRenaming(tag);
                  }}
                >
                  Rename
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRemoving(tag)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-caption text-ink-3">
        A tag never changes a figure. It is only how you find things again.
      </p>

      <BottomSheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={renaming ? `Rename ${renaming.name}` : 'Rename'}
        description="Every payment carrying it takes the new name. Nothing else changes."
        footer={
          <Button
            variant="primary"
            block
            disabled={busy || draft.trim() === ''}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save the new name'}
          </Button>
        }
      >
        <Input
          aria-label="The new name"
          type="text"
          value={draft}
          maxLength={MAX_TAG_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
      </BottomSheet>

      <BottomSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : 'Remove this tag?'}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="primary" block disabled={busy} onClick={() => void remove()}>
              {busy ? 'Removing…' : 'Remove the tag'}
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-body text-ink-2">
          {removing ? describeTagRemoval(removing.name, removing.usedOn) : ''}
        </p>
      </BottomSheet>
    </div>
  );
}

/* --- categories and groups ------------------------------------------------ */

function TaxonomyTab() {
  const taxonomy = useTaxonomy(true);
  const [addingGroup, setAddingGroup] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [archiving, setArchiving] = useState<CategoryNode | null>(null);

  const data = taxonomy.data;
  const hasArchived = (data?.all ?? []).some((c) => c.archivedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAddingCategory(true)}>
          Add a category
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAddingGroup(true)}>
          Add a group
        </Button>
      </div>

      {data === undefined ? (
        <Card>
          <p className="py-6 text-center text-caption text-ink-3">Loading your categories…</p>
        </Card>
      ) : data.all.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">Nothing set up yet</p>
            <p className="max-w-[36ch] text-caption text-ink-2">
              Add the first one and it will be offered whenever you record a payment.
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <List>
            {data.groups.map((group) => (
              <li key={group.groupId}>
                <ul>
                  <ListSectionHeader>{group.name}</ListSectionHeader>
                  {group.categories.map((category) => (
                    <CategoryRow
                      key={category.categoryId}
                      category={category}
                      onEdit={() => setEditing(category)}
                      onArchive={() => setArchiving(category)}
                    />
                  ))}
                  {group.categories.length === 0 && (
                    <li className="px-4 py-3 text-caption text-ink-3">
                      Nothing in this group yet.
                    </li>
                  )}
                </ul>
              </li>
            ))}

            {data.ungrouped.length > 0 && (
              <li>
                <ul>
                  <ListSectionHeader>Not in a group</ListSectionHeader>
                  {data.ungrouped.map((category) => (
                    <CategoryRow
                      key={category.categoryId}
                      category={category}
                      onEdit={() => setEditing(category)}
                      onArchive={() => setArchiving(category)}
                    />
                  ))}
                </ul>
              </li>
            )}
          </List>
        </Card>
      )}

      {hasArchived && <ArchivedList />}

      <AddGroupSheet open={addingGroup} onClose={() => setAddingGroup(false)} />
      <CategorySheet
        open={addingCategory || editing !== null}
        category={editing}
        onClose={() => {
          setAddingCategory(false);
          setEditing(null);
        }}
      />
      <ArchiveSheet category={archiving} onClose={() => setArchiving(null)} />
    </div>
  );
}

function CategoryRow({
  category,
  onEdit,
  onArchive,
}: {
  category: CategoryNode;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void countEntriesForCategory(category.categoryId).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [category.categoryId]);

  return (
    <ListItem
      title={category.name}
      subtitle={
        count === null
          ? ' '
          : count === 0
            ? 'Nothing filed here yet'
            : `${count} ${count === 1 ? 'payment' : 'payments'}`
      }
      trailing={
        <span className="flex gap-2">
          <Button variant="quiet" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="quiet" size="sm" onClick={onArchive}>
            Archive
          </Button>
        </span>
      }
    />
  );
}

function ArchivedList() {
  const taxonomy = useTaxonomy(true);
  const archived = (taxonomy.data?.all ?? []).filter((c) => c.archivedAt);
  if (archived.length === 0) return null;

  return (
    <Card label="No longer used">
      <p className="pb-3 text-caption text-ink-2">
        Kept so your past months still add up. Not offered for anything new.
      </p>
      <div className="flex flex-wrap gap-2">
        {archived.map((category) => (
          <Chip
            key={category.categoryId}
            onClick={() => {
              void restoreCategory(category.categoryId).then(() =>
                toast(`${category.name} is back in use.`),
              );
            }}
          >
            {category.name} · put back
          </Chip>
        ))}
      </div>
    </Card>
  );
}

/* --- the sheets ----------------------------------------------------------- */

function AddGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setProblem(null);
      setBusy(false);
    }
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      await createCategoryGroup({ name });
      toast(`Added the group "${name.trim()}".`);
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be added.');
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add a group"
      description="Groups gather related categories together, so a long list stays readable."
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="What is it called?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Hobbies, Family, Work…"
          {...(problem ? { error: problem } : {})}
        />
        <Button variant="primary" block disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? 'Adding…' : 'Add the group'}
        </Button>
      </div>
    </BottomSheet>
  );
}

function CategorySheet({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: CategoryNode | null;
  onClose: () => void;
}) {
  const taxonomy = useTaxonomy();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setGroupId(category?.groupId ?? '');
    setProblem(null);
    setBusy(false);
  }, [open, category]);

  const groups = (taxonomy.data?.groups ?? []).map((g) => ({ value: g.groupId, label: g.name }));

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      if (category) {
        await updateCategory(category.categoryId, {
          name,
          groupId: (groupId || null) as AccountId | null,
        });
        toast(`Saved. It is called "${name.trim()}" now.`);
      } else {
        await createCategory({ name, groupId: (groupId || null) as AccountId | null });
        toast(`Added "${name.trim()}". You can file payments under it straight away.`);
      }
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={category ? 'Edit this category' : 'Add a category'}
      {...(category
        ? {}
        : {
            description:
              'It will be offered whenever you record a payment, and gets its own pot in your budget.',
          })}
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="What is it called?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Childcare, Books and music…"
          {...(problem ? { error: problem } : {})}
        />

        <Select
          label="Which group?"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          options={[{ value: '', label: 'No group' }, ...groups]}
        />

        <Button variant="primary" block disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : category ? 'Save the change' : 'Add the category'}
        </Button>
      </div>
    </BottomSheet>
  );
}

function ArchiveSheet({
  category,
  onClose,
}: {
  category: CategoryNode | null;
  onClose: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    void countEntriesForCategory(category.categoryId).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [category]);

  async function archive() {
    if (!category) return;
    setBusy(true);
    try {
      await archiveCategory(category.categoryId);
      toast(`${category.name} will not be offered any more. Your past payments are untouched.`);
      onClose();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'That could not be archived.',
        { tone: 'attention' },
      );
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={category !== null}
      onClose={onClose}
      title={category ? `Stop using ${category.name}?` : 'Stop using this?'}
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-body text-ink">
          {count === null
            ? 'Checking what is filed here…'
            : count === 0
              ? 'Nothing has been filed here yet, so nothing will change except that it stops ' +
                'being offered.'
              : `This category has ${count} past ${count === 1 ? 'payment' : 'payments'}. ` +
                `Archiving it will keep your past records intact, but hide it from future ` +
                `payments.`}
        </p>
        <p className="text-caption text-ink-3">
          Nothing is deleted, and you can put it back at any time.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            Keep using it
          </Button>
          <Button variant="primary" block disabled={busy} onClick={() => void archive()}>
            {busy ? 'Archiving…' : 'Stop using it'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/* --- rules ---------------------------------------------------------------- */

function RulesTab() {
  const rules = useRules();
  const picker = useCategoryPicker();

  const nameOf = useCallback(
    (categoryId: string) => picker.byId.get(categoryId)?.name ?? 'a category that no longer exists',
    [picker.byId],
  );

  const list = rules.data ?? [];

  if (rules.data === undefined) {
    return (
      <Card>
        <p className="py-6 text-center text-caption text-ink-3">Loading your rules…</p>
      </Card>
    );
  }

  if (list.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-lead text-ink">No rules yet</p>
          <p className="max-w-[38ch] text-caption text-ink-2">
            When you file a payment, tick &ldquo;always file this shop here&rdquo; and the rule
            will appear on this page. Anything matching it gets filed for you from then on.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <List>
        {list.map((rule) => (
          <ListItem
            key={rule.id}
            muted={!rule.active}
            title={`Anything matching “${rule.pattern}”`}
            subtitle={
              `Filed as ${nameOf(rule.categoryId).toLowerCase()}` +
              (rule.matchCount > 0
                ? ` · used ${rule.matchCount} ${rule.matchCount === 1 ? 'time' : 'times'}`
                : ' · not used yet')
            }
            trailing={
              <span className="flex gap-2">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    void setRuleActive(rule.id, !rule.active).then(() =>
                      toast(rule.active ? 'That rule is paused.' : 'That rule is on again.'),
                    );
                  }}
                >
                  {rule.active ? 'Pause' : 'Turn on'}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    void deleteRule(rule.id).then(() => toast('That rule is gone.'));
                  }}
                >
                  Delete
                </Button>
              </span>
            }
          />
        ))}
      </List>
    </Card>
  );
}
