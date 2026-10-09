import React, { useMemo, useState } from 'react';
import { Alert, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { discoveryApi, mediaApi } from '../api/endpoints';
import { RemoteImage } from './Feedback';
import { colors, radius, spacing, typography } from '../theme';
import type { DiscoveryCandidate } from '../types/api';

type SwipeType = 'PASS' | 'LIKE' | 'SUPER_LIKE';

interface Props {
  candidate: DiscoveryCandidate;
  onSwiped: () => void;
}

const SWIPE_THRESHOLD = 110;

/**
 * Swipe card.
 *
 * The card only ever shows an APPROXIMATE location (area name + coarse
 * distance). Raw coordinates are never rendered anywhere in the dating flow -
 * they do not even exist in the API response for another user's profile.
 */
export function SwipeCard({ candidate, onSwiped }: Props): React.JSX.Element {
  const queryClient = useQueryClient();
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const photo = useQuery({
    queryKey: ['media-url', candidate.photoMediaId],
    queryFn: () => mediaApi.url(candidate.photoMediaId as string),
    enabled: !!candidate.photoMediaId,
    staleTime: 5 * 60_000,
  });

  const swipe = useMutation({
    mutationFn: (type: SwipeType) => discoveryApi.swipe(candidate.userId, type),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
      if (result.matched) {
        Alert.alert(
          "It's a match!",
          `${candidate.displayName} liked you too. Compatibility score ${result.compatibilityScore}%. Start a conversation.`,
        );
      }
      setPosition({ x: 0, y: 0 });
      onSwiped();
    },
    onError: (error: Error) => {
      Alert.alert('Could not complete that', error.message);
      setPosition({ x: 0, y: 0 });
    },
  });

  const undo = useMutation({
    mutationFn: () => discoveryApi.undo(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });

  const commit = (type: SwipeType) => swipe.mutate(type);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
        onPanResponderMove: (_, gesture) => setPosition({ x: gesture.dx, y: gesture.dy }),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > SWIPE_THRESHOLD) commit('LIKE');
          else if (gesture.dx < -SWIPE_THRESHOLD) commit('PASS');
          else setPosition({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => setPosition({ x: 0, y: 0 }),
      }),
    // commit is stable enough for gesture handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rotate = (position.x / 40) * 8;
  const likeOpacity = Math.max(0, Math.min(1, position.x / SWIPE_THRESHOLD));
  const passOpacity = Math.max(0, Math.min(1, -position.x / SWIPE_THRESHOLD));

  return (
    <View style={styles.wrapper}>
      <View
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={`${candidate.displayName}, ${candidate.age}. Swipe right to like, left to pass.`}
        style={[
          styles.card,
          { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate: `${rotate}deg` }] },
        ]}
      >
        <RemoteImage uri={photo.data?.url} style={styles.photo} />

        <View style={styles.overlay} pointerEvents="none">
          <Text style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}>LIKE</Text>
          <Text style={[styles.stamp, styles.passStamp, { opacity: passOpacity }]}>PASS</Text>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {candidate.displayName}, {candidate.age}
            </Text>
            {candidate.selfieVerified ? <Text style={styles.verified}>âœ“</Text> : null}
            {candidate.boosted ? <Text style={styles.boost}>BOOST</Text> : null}
          </View>

          {candidate.areaName ? <Text style={styles.area}>ðŸ“ {candidate.areaName}</Text> : null}
          <Text style={styles.distance}>{candidate.distanceText}</Text>

          <View style={styles.scoreRow}>
            <Text style={styles.score}>â¤ï¸ {candidate.compatibilityScore}% compatible</Text>
            {candidate.isOnline ? <Text style={styles.online}>Online</Text> : null}
          </View>

          {candidate.commonInterests.length > 0 ? (
            <Text style={styles.interests}>âœ“ {candidate.commonInterests.join(', ')}</Text>
          ) : null}
          {candidate.bio ? (
            <Text style={styles.bio} numberOfLines={2}>
              {candidate.bio}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <ActionButton label="âœ•" color={colors.danger} onPress={() => commit('PASS')} />
        <ActionButton label="â†º" color={colors.textMuted} onPress={() => undo.mutate()} loading={undo.isPending} />
        <ActionButton label="â˜…" color={colors.accent} onPress={() => commit('SUPER_LIKE')} />
        <ActionButton label="â™¥" color={colors.primary} onPress={() => commit('LIKE')} />
      </View>
    </View>
  );
}

function ActionButton({
  label,
  color,
  onPress,
  loading = false,
}: {
  label: string;
  color: string;
  onPress: () => void;
  loading?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.action, { borderColor: color, opacity: pressed || loading ? 0.6 : 1 }]}
    >
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: '100%', height: '58%', borderRadius: 0 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  stamp: {
    position: 'absolute',
    fontSize: 40,
    fontWeight: '800',
    borderWidth: 4,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  likeStamp: { color: colors.success, borderColor: colors.success, transform: [{ rotate: '-18deg' }] },
  passStamp: { color: colors.danger, borderColor: colors.danger, transform: [{ rotate: '18deg' }] },
  info: { padding: spacing.md, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.heading },
  verified: { color: colors.primary, fontWeight: '800' },
  boost: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  area: { ...typography.body },
  distance: { ...typography.caption },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  score: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  online: { color: colors.success, fontSize: 12, fontWeight: '600' },
  interests: { ...typography.caption, color: colors.text },
  bio: { ...typography.caption, marginTop: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.md },
  action: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 22, fontWeight: '700' },
});
