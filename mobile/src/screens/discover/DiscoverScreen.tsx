import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../../api/client';
import { discoveryApi } from '../../api/endpoints';
import { SwipeCard } from '../../components/SwipeCard';
import { EmptyState, ErrorState, Loader, OfflineBanner } from '../../components/Feedback';
import { useAreaStore } from '../../store/settings.store';
import { colors, radius, spacing, typography } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

type Mode = 'nearby' | 'recommended' | 'new' | 'active';

/**
 * Discover.
 *
 * When the account is outside the served Iringa boundary the API answers 503
 * with OUTSIDE_SUPPORTED_REGION. We show a clear notice instead of an empty
 * feed - and we never delete or lock the account.
 */
export function DiscoverScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('recommended');
  const scopeNotice = useAreaStore((s) => s.scopeNotice);

  const query = useInfiniteQuery({
    queryKey: ['discovery', mode],
    queryFn: ({ pageParam }) => discoveryApi.discover({ mode, limit: 10, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const candidates = query.data?.pages.flatMap((page) => page.items) ?? [];
  const current = candidates[0];

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  if (query.isLoading) return <Loader label="Finding people near you" />;

  const error = query.error;
  if (error instanceof ApiError && error.status === 503) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Iringa only, for now"
          subtitle={error.message ?? 'Dating discovery is currently available in Iringa only.'}
        />
      </View>
    );
  }
  if (error) return <ErrorState message={error.message} onRetry={() => void query.refetch()} />;

  if (!current) {
    return (
      <View style={styles.container}>
        <ModeSwitch mode={mode} onChange={setMode} />
        <EmptyState
          title="No profiles yet"
          subtitle="Try a different mode or widen your distance filter. New people join every day."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner visible={query.isError} />
      {scopeNotice ? <Text style={styles.notice}>{scopeNotice}</Text> : null}

      <ModeSwitch mode={mode} onChange={setMode} />

      <SwipeCard
        key={current.userId}
        candidate={current}
        onSwiped={() => {
          void queryClient.invalidateQueries({ queryKey: ['discovery'] });
          loadMore();
        }}
      />

      <Pressable style={styles.filters} onPress={() => navigation.navigate('Filters')} accessibilityRole="button">
        <Text style={styles.filtersText}>Filters</Text>
      </Pressable>
    </View>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }): React.JSX.Element {
  const options: Array<{ key: Mode; label: string }> = [
    { key: 'nearby', label: 'Nearby' },
    { key: 'recommended', label: 'For you' },
    { key: 'new', label: 'New' },
    { key: 'active', label: 'Active' },
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => onChange(option.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === option.key }}
          style={[styles.mode, mode === option.key && styles.modeActive]}
        >
          <Text style={[styles.modeText, mode === option.key && styles.modeTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, gap: spacing.sm },
  notice: { ...typography.caption, color: colors.accent, textAlign: 'center' },
  modes: { gap: spacing.sm, paddingVertical: spacing.xs },
  mode: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  filters: { alignSelf: 'center', padding: spacing.sm },
  filtersText: { color: colors.primary, fontWeight: '600' },
});
