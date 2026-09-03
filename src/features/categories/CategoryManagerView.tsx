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
  Select,
  Tabs,
} from '@/design/ui';

type TabValue = 'taxonomy' | 'rules';

export function CategoryManagerView() {
  const [, navigate] = useRoute();
  const [tab, setTab] = useState<TabValue>('taxonomy');
  const taxonomy = useTaxonomy(true);
  const rules = useRules();

  const activeCount = (taxonomy.data?.all ?? []).filter((c) => !c.archivedAt).length;
  const ruleCount = (rules.data ?? []).filter((r) => r.active).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Categories and rules</h1>
        <p className="text-caption text-ink-2">
          How your spending is divided up, and anything you have asked Sovereign to file for
          you.
        </p>
      </header>

      <Tabs
        label="Categories or rules"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'taxonomy', label: 'Categories', count: activeCount },
          { value: 'rules', label: 'Rules', count: ruleCount },
        ]}
      />

      {tab === 'taxonomy' ? <TaxonomyTab /> : <RulesTab />}

      <div>
        <Button variant="secondary" onClick={() => navigate('settings')}>
          Back to settings
        </Button>
      </div>
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
              Categories are how your spending gets divided up. Add the first one and it will be
              offered whenever you record a payment.
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
        These are kept so your past months still add up. They are not offered when you record
        something new.
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
