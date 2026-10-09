import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { videoApi } from '../api/endpoints';
import { Button } from './Button';
import { EmptyState, Loader } from './Feedback';
import { colors, radius, spacing, typography } from '../theme';

const formatTzs = (minor: number, currency: string): string =>
  `${currency} ${(minor / 100).toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`;

/**
 * Premium media library.
 *
 * Free videos play straight away. Premium videos are TZS 1,000 each, and an
 * already-owned video is never charged again - the server decides that, and
 * the catalog already reports `owned`.
 */
export function VideoLibraryScreen(): React.JSX.Element {
  const [category, setCategory] = useState<string | undefined>(undefined);

  const categories = useQuery({ queryKey: ['video-categories'], queryFn: videoApi.categories, staleTime: 600_000 });
  const catalog = useQuery({
    queryKey: ['videos', category],
    queryFn: () => videoApi.catalog({ category }),
  });

  const queryClient = useQueryClient();

  const purchase = useMutation({
    mutationFn: (videoId: string) => videoApi.purchase(videoId, `${videoId}-${Date.now()}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['videos'] });
      Alert.alert('Payment started', 'The video unlocks as soon as the payment is confirmed.');
    },
    onError: (error: Error) => Alert.alert('Could not start the payment', error.message),
  });

  const play = useMutation({
    mutationFn: (videoId: string) => videoApi.play(videoId),
    onSuccess: (result) => {
      // Signed URL, short lived. We hand it to the native player in a real build.
      Alert.alert('Ready to play', `Signed stream URL valid for ${result.expiresInSeconds}s.`);
    },
    onError: (error: Error) => Alert.alert('Locked', error.message),
  });

  if (catalog.isLoading) return <Loader label="Loading library" />;

  const items = catalog.data ?? [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Videos</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={!category} onPress={() => setCategory(undefined)} />
        {(categories.data ?? []).map((item) => (
          <Chip
            key={item.slug}
            label={`${item.emoji ?? ''} ${item.labelEn}`}
            active={category === item.slug}
            onPress={() => setCategory(item.slug)}
          />
        ))}
      </ScrollView>

      {items.length === 0 ? (
        <EmptyState title="No videos yet" subtitle="An admin has not published any media yet." />
      ) : null}

      {items.map((video) => (
        <View key={video.id} style={styles.card}>
          {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={styles.thumb} /> : null}

          <Text style={typography.body}>{video.title}</Text>
          <Text style={typography.caption}>
            {video.category.emoji} {video.category.labelEn}
            {video.durationSec ? ` · ${Math.round(video.durationSec / 60)} min` : ''}
          </Text>

          {video.isPremium ? (
            <Text style={styles.price}>{video.owned ? '✓ Owned' : formatTzs(video.priceMinor, video.currency)}</Text>
          ) : (
            <Text style={styles.free}>Free</Text>
          )}

          {video.owned || !video.isPremium ? (
            <Button label="Play" variant="secondary" onPress={() => play.mutate(video.id)} />
          ) : (
            <Button
              label={`Buy ${formatTzs(video.priceMinor, video.currency)}`}
              onPress={() => purchase.mutate(video.id)}
              loading={purchase.isPending}
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  chips: { gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  card: { gap: spacing.xs, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  thumb: { width: '100%', height: 160, borderRadius: radius.md, marginBottom: spacing.sm },
  price: { color: colors.primary, fontWeight: '700' },
  free: { color: colors.success, fontWeight: '700' },
});
