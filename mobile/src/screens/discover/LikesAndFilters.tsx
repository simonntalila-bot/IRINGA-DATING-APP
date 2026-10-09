import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { discoveryApi, matchApi, profileApi } from '../../api/endpoints';
import { EmptyState, Loader, RemoteImage } from '../../components/Feedback';
import { Button } from '../../components/Button';
import { colors, radius, spacing, typography } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';
import type { MatchListItem } from '../../types/api';

export function LikesScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const matches = useQuery({ queryKey: ['matches'], queryFn: matchApi.list });
  const likes = useQuery({
    queryKey: ['likes-received'],
    queryFn: discoveryApi.likesReceived,
    retry: false,
  });

  if (matches.isLoading) return <Loader />;

  const items = matches.data ?? [];
  const likesUnavailable = !!likes.error;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Matches</Text>

      {likesUnavailable ? (
        <Text style={styles.captionMuted}>
          Likes received is a Premium feature. Upgrade to see everyone who liked you.
        </Text>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No matches yet" subtitle="Keep swiping - mutual likes land here." />
      ) : (
        items.map((item: MatchListItem) => (
          <Pressable
            key={item.matchId}
            style={styles.row}
            onPress={() =>
              item.conversationId
                ? navigation.navigate('Tabs', {
                    screen: 'Messages',
                    params: { conversationId: item.conversationId },
                  })
                : undefined
            }
            accessibilityRole="button"
          >
            <RemoteImage uri={null} style={styles.avatar} />
            <View style={styles.rowBody}>
              <Text style={typography.body}>
                {item.user.displayName}
                {item.user.age ? `, ${item.user.age}` : ''}
              </Text>
              {item.user.location.areaName ? (
                <Text style={typography.caption}>ðŸ“ {item.user.location.areaName}</Text>
              ) : null}
              <Text style={typography.caption}>{item.user.location.distanceText}</Text>
            </View>
            <Text style={styles.score}>{item.compatibilityScore}%</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

export function FiltersScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('45');
  const [distance, setDistance] = useState('50');

  const save = useMutation({
    mutationFn: () =>
      profileApi.update({
        minAge: Number(minAge),
        maxAge: Number(maxAge),
        maxDistanceKm: Number(distance),
      }),
    onSuccess: () => {
      Alert.alert('Saved', 'Your discovery preferences were updated.');
      navigation.goBack();
    },
    onError: (error: Error) => Alert.alert('Could not save', error.message),
  });

  const valid =
    Number(minAge) >= 18 && Number(maxAge) >= Number(minAge) && Number(distance) >= 1 && Number(distance) <= 200;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Filters</Text>
      <Text style={typography.caption}>Saved to your profile, applied server side on every discovery request.</Text>

      <Text style={styles.label}>Minimum age</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={minAge} onChangeText={setMinAge} />

      <Text style={styles.label}>Maximum age</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={maxAge} onChangeText={setMaxAge} />

      <Text style={styles.label}>Maximum distance (km)</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={distance} onChangeText={setDistance} />

      <Button label="Save preferences" onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} />
      <Button label="Close" variant="ghost" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 56, height: 56, borderRadius: radius.pill },
  rowBody: { flex: 1 },
  score: { color: colors.primary, fontWeight: '700' },
  captionMuted: { ...typography.caption, color: colors.textMuted },
  label: { ...typography.caption, marginTop: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
});
