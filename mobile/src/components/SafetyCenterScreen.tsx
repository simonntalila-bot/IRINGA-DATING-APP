import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { locationSharingApi, privacyApi, reportApi } from '../api/endpoints';
import { Button } from './Button';
import { Loader } from './Feedback';
import { ToggleRow } from '../screens/profile/ProfileScreens';
import { colors, spacing, typography } from '../theme';
import type { MainStackParamList } from '../navigation/types';

type Nav = { goBack: () => void; navigate: (screen: keyof MainStackParamList) => void };

/** Reasons that matter most for an adult dating app (spec section 32). */
const SAFETY_REASONS = [
  'SCAM',
  'HARASSMENT',
  'THREAT',
  'UNDERAGE',
  'NON_CONSENSUAL_CONTENT',
  'BLACKMAIL_EXTORTION',
  'PROHIBITED_SEXUAL_SERVICES',
  'TRAFFICKING_OR_COERCION',
] as const;

/**
 * Safety Center + live location controls.
 *
 * Every switch here maps to a server-side consent flag, and the "who can see my
 * location" list is the authoritative view - if a grant appears there it is
 * active on the server, not just hidden in the UI.
 */
export function SafetyCenterScreen({ route }: { route?: { params?: { userId?: string } } }): React.JSX.Element {
  const targetId = route?.params?.userId ?? '';
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<string>(SAFETY_REASONS[0]);
  const [selectedReason, setSelectedReason] = useState<string>(SAFETY_REASONS[0]);

  const settings = useQuery({ queryKey: ['privacy'], queryFn: privacyApi.settings });
  const active = useQuery({ queryKey: ['location-active'], queryFn: locationSharingApi.active });
  const requests = useQuery({ queryKey: ['location-requests'], queryFn: locationSharingApi.requests });

  const respond = useMutation({
    mutationFn: (input: { shareId: string; accept: boolean }) =>
      locationSharingApi.respond(input.shareId, input.accept),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['location-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['location-active'] });
    },
    onError: (error: Error) => Alert.alert('Could not respond', error.message),
  });

  const stop = useMutation({
    mutationFn: (recipientId: string) => locationSharingApi.stop(recipientId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['location-active'] }),
  });

  if (settings.isLoading) return <Loader />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Safety Center</Text>

      <Text style={styles.section}>My live location</Text>
      <Text style={typography.caption}>
        Nobody can see where you are unless you accept a request. Grants expire on their own and you can stop them
        instantly.
      </Text>

      <ToggleRow
        label="Allow location requests"
        description="Lets someone who has your contact ask to see your area temporarily."
        value={(settings.data?.allowLocationRequests as boolean | undefined) ?? false}
        onChange={(v: boolean) =>
          privacyApi
            .update({ allowLocationRequests: v })
            .then(() => queryClient.invalidateQueries({ queryKey: ['privacy'] }))
        }
      />

      <Text style={styles.section}>Requests waiting for me</Text>
      {(requests.data ?? []).length === 0 ? (
        <Text style={typography.caption}>No pending requests.</Text>
      ) : (
        (requests.data ?? []).map((request) => (
          <View key={request.id} style={styles.row}>
            <Text style={typography.body}>
              Asked for {request.requestedMinutes} minutes{request.note ? ` - ${request.note}` : ''}
            </Text>
            <View style={styles.rowActions}>
              <Button label="Accept" onPress={() => respond.mutate({ shareId: request.id, accept: true })} />
              <Button
                label="Decline"
                variant="ghost"
                onPress={() => respond.mutate({ shareId: request.id, accept: false })}
              />
            </View>
          </View>
        ))
      )}

      <Text style={styles.section}>Who can see my location right now</Text>
      {(active.data ?? []).length === 0 ? (
        <Text style={typography.caption}>Nobody.</Text>
      ) : (
        (active.data ?? []).map((permission) => (
          <View key={permission.permissionId} style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={typography.body}>{permission.recipientName}</Text>
              <Text style={typography.caption}>{permission.minutesRemaining} minutes remaining</Text>
            </View>
            <Button label="Stop now" variant="danger" onPress={() => stop.mutate(permission.recipientName)} />
          </View>
        ))
      )}

      <Text style={styles.section}>Report a problem</Text>
      <Text style={typography.caption}>
        Reports are confidential. Serious safety reports are reviewed within 24 hours. If anyone is in immediate danger,
        contact emergency services first.
      </Text>

      <View style={styles.reasons}>
        {SAFETY_REASONS.map((item) => (
          <Text
            key={item}
            onPress={() => {
              setReason(item);
              setSelectedReason(item);
            }}
            style={[styles.reasonChip, selectedReason === item && styles.reasonChipActive]}
          >
            {item.replace(/_/g, ' ').toLowerCase()}
          </Text>
        ))}
      </View>

      <Text style={typography.caption}>Selected: {reason.replace(/_/g, ' ').toLowerCase()}</Text>

      <Button
        label="Send report"
        variant="secondary"
        disabled={!targetId}
        onPress={async () => {
          try {
            await reportApi.reportUser(targetId, selectedReason);
            Alert.alert('Report sent', 'Our moderation team will review this.');
          } catch (error) {
            Alert.alert('Could not send the report', (error as Error).message);
          }
        }}
      />

      <Button label="Back" variant="ghost" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  section: { ...typography.heading, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowBody: { flex: 1 },
  rowActions: { flexDirection: 'row', gap: spacing.sm },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  reasonChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: 12,
  },
  reasonChipActive: { backgroundColor: colors.danger, borderColor: colors.danger, color: '#fff' },
  legal: { color: colors.textMuted, fontSize: 12 },
});
