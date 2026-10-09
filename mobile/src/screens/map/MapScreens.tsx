import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { placeApi } from '../../api/endpoints';
import { useAreaStore } from '../../store/settings.store';
import { Button } from '../../components/Button';
import { Loader } from '../../components/Feedback';
import { colors, radius, spacing, typography } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

const IRINGA_CENTER: Region = {
  latitude: -7.7669,
  longitude: 35.2313,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

/**
 * Explore Iringa.
 *
 * Places come from the admin-managed database - nothing about Iringa is
 * hard-coded in this app, so new venues appear without an app update.
 */
export function MapScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const areaName = useAreaStore((s) => s.areaName);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [datingFriendly, setDatingFriendly] = useState(false);

  const categories = useQuery({
    queryKey: ['place-categories'],
    queryFn: placeApi.categories,
    staleTime: 60 * 60_000,
  });

  const places = useQuery({
    queryKey: ['places', category, datingFriendly],
    queryFn: () => placeApi.list({ category, datingFriendly: datingFriendly ? 'true' : undefined, radiusKm: 40 }),
    staleTime: 5 * 60_000,
  });

  if (categories.isLoading) return <Loader label="Loading Iringa places" />;

  return (
    <View style={styles.container}>
      <MapView provider={PROVIDER_GOOGLE} style={styles.map} initialRegion={IRINGA_CENTER} showsUserLocation={false}>
        {(places.data ?? []).map((place) => (
          <Marker
            key={place.id}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            title={place.name}
            description={place.isDatingFriendly ? 'Dating friendly' : place.category.labelEn}
            onPress={() => navigation.navigate('PlaceDetails', { placeId: place.id })}
          />
        ))}
      </MapView>

      <View style={styles.panel}>
        <Text style={typography.heading}>{areaName ? `Near ${areaName}` : 'Explore Iringa'}</Text>

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

        <Button
          label={datingFriendly ? '✓ Dating-friendly only' : 'Show dating-friendly only'}
          variant={datingFriendly ? 'primary' : 'secondary'}
          onPress={() => setDatingFriendly((v) => !v)}
        />

        <Text style={typography.caption}>{(places.data ?? []).length} place(s) loaded from the admin database.</Text>
      </View>
    </View>
  );
}

export function PlaceDetailsScreen({ route }: { route: { params: { placeId: string } } }): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const { placeId } = route.params;

  const { data, isLoading } = useQuery({
    queryKey: ['place', placeId],
    queryFn: () => placeApi.detail(placeId),
  });

  if (isLoading) return <Loader />;
  if (!data) {
    return (
      <View style={styles.container}>
        <Text style={typography.body}>This place is not available.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.detail}>
      <Text style={typography.title}>{data.name}</Text>
      <Text style={typography.caption}>
        {data.category.emoji} {data.category.labelEn}
        {data.isDatingFriendly ? ' · Dating friendly' : ''}
      </Text>
      {data.description ? <Text style={typography.body}>{data.description}</Text> : null}
      {data.address ? <Text style={typography.body}>📍 {data.address}</Text> : null}
      {data.openingHours ? (
        <Text style={typography.body}>
          🕒{' '}
          {Object.entries(data.openingHours)
            .map(([day, hours]) => `${day}: ${hours}`)
            .join('\n')}
        </Text>
      ) : null}
      {data.distanceKm != null ? <Text style={typography.body}>~{data.distanceKm} km away</Text> : null}
      {data.phone ? <Text style={typography.body}>☎ {data.phone}</Text> : null}
      {data.website ? <Text style={typography.body}>🌐 {data.website}</Text> : null}

      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
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
  container: { flex: 1 },
  map: { flex: 1 },
  panel: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing.sm,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
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
  detail: { padding: spacing.lg, gap: spacing.sm },
});
