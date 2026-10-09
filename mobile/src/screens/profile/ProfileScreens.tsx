import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { notificationApi, profileApi, userApi } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { Button } from '../../components/Button';
import { Loader, RemoteImage } from '../../components/Feedback';
import { colors, radius, spacing, typography } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

interface MeResponse {
  displayName: string;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  profileCompletePct: number;
  age?: number;
  photos?: Array<{ mediaId: string }>;
  displayedAreaNode?: { name: string } | null;
  verification?: { phone: boolean; selfie: boolean };
}

export function ProfileScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const signOut = useAuthStore((s) => s.signOut);

  const me = useQuery({ queryKey: ['profile-me'], queryFn: profileApi.me });

  if (me.isLoading) return <Loader />;

  const profile = (me.data ?? {}) as unknown as MeResponse;
  const photoId = profile.photos?.[0]?.mediaId ?? null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <RemoteImage uri={null} style={styles.avatar} />
        <View style={styles.headerBody}>
          <Text style={typography.title}>{profile.displayName ?? 'Your profile'}</Text>
          {profile.displayedAreaNode?.name ? (
            <Text style={typography.caption}>ðŸ“ {profile.displayedAreaNode.name}</Text>
          ) : null}
          <Text style={typography.caption}>{profile.profileCompletePct ?? 0}% complete</Text>
          {profile.verification?.selfie ? <Text style={styles.verified}>âœ“ Verified</Text> : null}
        </View>
      </View>

      {profile.bio ? <Text style={typography.body}>{profile.bio}</Text> : null}
      {profile.occupation ? <Text style={typography.caption}>ðŸ’¼ {profile.occupation}</Text> : null}
      {profile.education ? <Text style={typography.caption}>ðŸŽ“ {profile.education}</Text> : null}

      <MenuRow label="My privacy & location" onPress={() => navigation.navigate('Privacy')} />
      <MenuRow label="Notifications" onPress={() => navigation.navigate('Notifications')} />
      <MenuRow label="Videos" onPress={() => navigation.navigate('Videos')} />
      <MenuRow label="My payments" onPress={() => navigation.navigate('Payments')} />
      <MenuRow label="Calls" onPress={() => navigation.navigate('Calls')} />
      <MenuRow label="Safety Center" onPress={() => navigation.navigate('Safety')} />
      <MenuRow label="Premium & boosts" onPress={() => navigation.navigate('Premium')} />

      <Button
        label="Sign out"
        variant="danger"
        onPress={() =>
          Alert.alert('Sign out', 'Sign out of this device only?', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Sign out',
              style: 'destructive',
              onPress: () => {
                void signOut(false);
              },
            },
          ])
        }
      />
      <Text style={styles.photoHint}>{photoId ? '' : 'Add a photo so people can see you.'}</Text>
    </ScrollView>
  );
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.menuRow} accessibilityRole="button">
      <Text style={typography.body}>{label}</Text>
      <Text style={typography.caption}>â€º</Text>
    </Pressable>
  );
}

/**
 * Location privacy controls.
 *
 * Each switch maps to an explicit consent flag on the server. Nothing is
 * shared with a match unless both sides are opted in.
 */
export function PrivacyScreen(): React.JSX.Element {
  const queryClient = useQueryClient();

  const privacy = useQuery({ queryKey: ['privacy'], queryFn: userApi.privacy });

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof userApi.updatePrivacy>[0]) => userApi.updatePrivacy(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['privacy'] }),
    onError: (error: Error) => Alert.alert('Could not update', error.message),
  });

  if (privacy.isLoading) return <Loader />;
  const settings = privacy.data;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Privacy</Text>
      <Text style={styles.explainer}>
        Your exact location is never shown to anyone. People only see the general area you choose, and a rough distance,
        and only when you both allow it.
      </Text>

      <ToggleRow
        label="Show my general area"
        description="Others see 'Kihesa' instead of nothing."
        value={settings?.locationVisibility !== 'HIDDEN'}
        onChange={(v) => update.mutate({ locationVisibility: v ? 'APPROXIMATE_AREA' : 'HIDDEN' })}
      />

      <ToggleRow
        label="Share my area with matches"
        description="Allows '~2 km away' and area alerts with people you match."
        value={settings?.shareAreaWithMatches ?? false}
        onChange={(v) => update.mutate({ shareAreaWithMatches: v })}
      />

      <ToggleRow
        label="Match area alerts"
        description='Notify me when a match is around an area (e.g. "Your match is now around Kihesa").'
        value={settings?.allowAreaActivityAlerts ?? false}
        onChange={(v) => update.mutate({ allowAreaActivityAlerts: v })}
      />

      <ToggleRow
        label="Nearby place alerts"
        description='Tell me when I am near a dating-friendly place, e.g. "You are near a lounge".'
        value={settings?.allowPlaceAlerts ?? false}
        onChange={(v) => update.mutate({ allowPlaceAlerts: v })}
      />

      <Text style={styles.explainer}>Discovery radius: {settings?.discoveryRadiusKm ?? 50} km</Text>
    </ScrollView>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleBody}>
        <Text style={typography.body}>{label}</Text>
        <Text style={typography.caption}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export function NotificationsScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationApi.list,
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: notificationApi.markAllRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Notifications</Text>
      <Button label="Mark all as read" variant="secondary" onPress={() => markAll.mutate()} />

      {(notifications.data ?? []).map((item) => (
        <View key={item.id} style={styles.notificationRow}>
          <Text style={typography.body}>{item.title}</Text>
          <Text style={typography.caption}>{item.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  headerBody: { flex: 1 },
  avatar: { width: 72, height: 72, borderRadius: radius.pill },
  verified: { color: colors.primary, fontWeight: '700' },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  explainer: { ...typography.caption, marginVertical: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleBody: { flex: 1 },
  notificationRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  photoHint: { ...typography.caption, textAlign: 'center' },
});
