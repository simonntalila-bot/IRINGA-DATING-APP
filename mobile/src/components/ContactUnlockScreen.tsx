import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contactApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { EmptyState, Loader } from './Feedback';
import { colors, radius, spacing, typography } from '../theme';

const formatTzs = (minor: number, currency: string): string =>
  `${currency} ${(minor / 100).toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`;

interface Props {
  route: { params: { userId: string; displayName?: string } };
}

/**
 * Contact unlock (TZS 1,000 per profile).
 *
 * Rules this screen must respect:
 *  - It shows the price from the SERVER quote, never a hard-coded number.
 *  - It never renders a phone number it did not receive from /contact/card.
 *  - A successful payment is not what unlocks the contact - the server does
 *    that after the gateway webhook, so the screen re-checks /status.
 */
export function ContactUnlockScreen({ route }: Props): React.JSX.Element {
  const { userId } = route.params;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const quote = useQuery({
    queryKey: ['contact-quote', userId],
    queryFn: () => contactApi.quote(userId),
  });

  const card = useQuery({
    queryKey: ['contact-card', userId],
    queryFn: () => contactApi.card(userId),
    // Refetched after a payment so the number appears only once the server
    // confirms the entitlement.
    enabled: quote.data?.alreadyUnlocked === true,
  });

  const purchase = useMutation({
    mutationFn: () => contactApi.purchase(userId, `${userId}-${Date.now()}`),
    onSuccess: async () => {
      setPending(true);
      // A real gateway would redirect/collect here; with the mock provider the
      // webhook is what moves the payment to SUCCESS.
      await queryClient.invalidateQueries({ queryKey: ['contact-quote', userId] });
      const status = await contactApi.status(userId);
      setPending(false);

      if (status.unlocked) {
        await queryClient.invalidateQueries({ queryKey: ['contact-card', userId] });
        Alert.alert('Contact unlocked', 'You can now see the contact details.');
      } else {
        Alert.alert(
          'Payment started',
          'Complete the payment in your mobile money app. The contact unlocks as soon as we receive confirmation.',
        );
      }
    },
    onError: (error: Error) => {
      setPending(false);
      if (error instanceof ApiError && (error.message.includes('already') || error.code === 'ALREADY_UNLOCKED')) {
        Alert.alert('Already unlocked', 'You have already paid for this contact.');
        void queryClient.invalidateQueries({ queryKey: ['contact-quote', userId] });
        return;
      }
      Alert.alert('Could not start the payment', error.message);
    },
  });

  if (quote.isLoading) return <Loader label="Checking availability" />;
  if (quote.isError) return <EmptyState title="Unavailable" subtitle="This profile cannot be loaded right now." />;

  if (!quote.data) return <EmptyState title="Unavailable" subtitle="This profile cannot be loaded right now." />;

  const data = quote.data;
  const unlocked = card.data;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Get contact</Text>

      <View style={styles.card}>
        <Text style={styles.price}>{formatTzs(data.priceMinor, data.currency)}</Text>
        <Text style={typography.caption}>
          One payment unlocks this person's contact details. Every other person is a separate payment.
        </Text>
      </View>

      {data.blockedReason === 'BLOCKED' ? (
        <Text style={[typography.caption, { color: colors.danger }]}>You cannot interact with this profile.</Text>
      ) : null}

      {!data.ownerAllowsContact ? (
        <View style={styles.notice}>
          <Text style={typography.body}>This person is not sharing contact details.</Text>
          <Text style={typography.caption}>
            Paying does not override their choice. You cannot unlock contact for someone who has turned sharing off.
          </Text>
        </View>
      ) : null}

      {data.alreadyUnlocked ? (
        <>
          <Text style={styles.unlockedBadge}>âœ“ Contact unlocked</Text>
          {unlocked?.phone ? (
            <View style={styles.contactBox}>
              <Text style={typography.heading}>{unlocked.phone}</Text>
              <View style={styles.actions}>
                <Button
                  label="Call"
                  onPress={() => Linking.openURL(`tel:${unlocked.phone}`)}
                  disabled={!unlocked.canCall}
                />
                {unlocked.whatsappUrl ? (
                  <Button
                    label="WhatsApp"
                    variant="secondary"
                    onPress={() => Linking.openURL(unlocked.whatsappUrl as string)}
                  />
                ) : null}
              </View>
              {unlocked.canRequestLocation ? (
                <Text style={typography.caption}>
                  You can request their live location - they decide whether to share it.
                </Text>
              ) : null}
            </View>
          ) : (
            <Loader label="Loading your unlocked contact" />
          )}
        </>
      ) : (
        <Button
          label={`Pay ${formatTzs(data.priceMinor, data.currency)}`}
          onPress={() => purchase.mutate()}
          loading={purchase.isPending || pending}
          disabled={!data.canPurchase}
        />
      )}

      <Text style={styles.legal}>
        This purchase is for access to an approved contact feature. It is not a purchase of a person. Profiles that
        advertise paid sexual services are prohibited and will be removed.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  price: { fontSize: 32, fontWeight: '800', color: colors.primary },
  notice: { backgroundColor: colors.overlay, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  unlockedBadge: { color: colors.success, fontWeight: '700', fontSize: 16 },
  contactBox: { gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  legal: { ...typography.caption, marginTop: spacing.md },
});
