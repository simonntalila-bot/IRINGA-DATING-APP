import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { paymentApi } from '../api/endpoints';
import { Button } from './Button';
import { Loader } from './Feedback';
import { colors, spacing, typography } from '../theme';

const formatTzs = (minor: number, currency: string): string =>
  `${currency} ${(minor / 100).toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`;

const statusColour = (status: string): string => {
  switch (status) {
    case 'SUCCESS':
    case 'ACTIVE':
      return colors.success;
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'REFUNDED':
    case 'REVOKED':
      return colors.danger;
    default:
      return colors.textMuted;
  }
};

/** My payments, contact unlocks and video purchases (spec section 28). */
export function PaymentsScreen(): React.JSX.Element {
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: paymentApi.wallet });

  if (wallet.isLoading) return <Loader label="Loading your transactions" />;

  const data = wallet.data;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>My payments</Text>

      <Text style={styles.sectionTitle}>Transactions</Text>
      {(data?.payments ?? []).map((payment) => (
        <View key={payment.id} style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={typography.body}>{payment.type.replace(/_/g, ' ').toLowerCase()}</Text>
            <Text style={typography.caption}>
              {new Date(payment.createdAt).toLocaleDateString()} · {payment.items.map((i) => i.label).join(', ')}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={typography.body}>{formatTzs(payment.amountMinor, payment.currency)}</Text>
            <Text style={[styles.status, { color: statusColour(payment.status) }]}>{payment.status}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Contact unlocks</Text>
      {(data?.contactUnlocks ?? []).map((unlock) => (
        <View key={unlock.id} style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={typography.body}>{unlock.profileName}</Text>
            <Text style={typography.caption}>{new Date(unlock.createdAt).toLocaleDateString()}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={typography.body}>{formatTzs(unlock.amountMinor, 'TZS')}</Text>
            <Text style={[styles.status, { color: statusColour(unlock.status) }]}>{unlock.status}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Videos</Text>
      {(data?.videoPurchases ?? []).map((purchase) => (
        <View key={purchase.id} style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={typography.body}>{purchase.title}</Text>
            <Text style={typography.caption}>{new Date(purchase.createdAt).toLocaleDateString()}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={typography.body}>{formatTzs(purchase.amountMinor, 'TZS')}</Text>
            <Text style={[styles.status, { color: statusColour(purchase.status) }]}>{purchase.status}</Text>
          </View>
        </View>
      ))}

      {(data?.payments ?? []).length === 0 ? (
        <Text style={typography.caption}>Nothing yet. Contact unlocks and video purchases appear here.</Text>
      ) : null}

      <Button
        label="Request a refund"
        variant="secondary"
        onPress={() => Alert.alert('Refunds', 'Contact support from the Safety Center with the transaction id.')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { ...typography.heading, marginTop: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowBody: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  status: { fontSize: 11, fontWeight: '700' },
});
