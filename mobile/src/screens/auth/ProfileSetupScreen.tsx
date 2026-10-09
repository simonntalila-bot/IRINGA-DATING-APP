import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { mediaApi, profileApi } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { Button } from '../../components/Button';
import { colors, radius, spacing, typography } from '../../theme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ProfileSetup'>;

const GOALS = ['MARRIAGE', 'LONG_TERM', 'SERIOUS_DATING', 'SHORT_TERM', 'FRIENDSHIP'];

/**
 * Profile setup: bio, relationship goal, interests, photos.
 *
 * Interests are stored as slugs so the compatibility engine compares them
 * directly; photos are uploaded through a signed URL, never through the API
 * body.
 */
export function ProfileSetupScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const setProfileComplete = useAuthStore((s) => s.setProfileComplete);

  const [bio, setBio] = useState('');
  const [occupation, setOccupation] = useState('');
  const [education, setEducation] = useState('');
  const [goal, setGoal] = useState('SERIOUS_DATING');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const catalogue = useQuery({ queryKey: ['interest-catalogue'], queryFn: profileApi.interests });
  const me = useQuery({ queryKey: ['profile-me'], queryFn: profileApi.me });

  const update = useMutation({
    mutationFn: () => profileApi.update({ bio, occupation, education, relationshipGoal: goal }),
    onError: (error: Error) => Alert.alert('Could not save', error.message),
  });

  const saveInterests = useMutation({
    mutationFn: () => profileApi.setInterests(selectedInterests),
    onError: (error: Error) => Alert.alert('Could not save interests', error.message),
  });

  const upload = useMutation({
    mutationFn: async (fromCamera: boolean) => {
      const result = fromCamera
        ? await launchCamera({ mediaType: 'photo', quality: 0.8, includeBase64: false })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });

      if (result.didCancel || !result.assets?.length) return;

      const asset = result.assets[0];
      if (!asset.uri || !asset.fileSize || !asset.type) {
        throw new Error('Could not read that image');
      }

      const completed = await mediaApi.upload({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        type: asset.type,
        size: asset.fileSize,
      });
      await profileApi.addPhoto(completed.mediaId);
    },
    onSuccess: () => void me.refetch(),
    onError: (error: Error) => Alert.alert('Upload failed', error.message),
  });

  const finish = async () => {
    try {
      if (bio || occupation || education) await update.mutateAsync();
      if (selectedInterests.length > 0) await saveInterests.mutateAsync();
      setProfileComplete(100);
      Alert.alert('You are ready', 'Start discovering people near you.', [
        { text: 'Go', onPress: () => navigation.navigate('LocationSetup') },
      ]);
    } catch {
      // Errors are already surfaced by the individual mutations.
    }
  };

  const toggleInterest = (slug: string) => {
    setSelectedInterests((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug].slice(0, 15),
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={typography.title}>Complete your profile</Text>

      <Text style={styles.label}>About me</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Tell people a little about yourself"
        multiline
        value={bio}
        onChangeText={setBio}
      />

      <Text style={styles.label}>Occupation</Text>
      <TextInput style={styles.input} value={occupation} onChangeText={setOccupation} />

      <Text style={styles.label}>Education</Text>
      <TextInput style={styles.input} value={education} onChangeText={setEducation} />

      <Text style={styles.label}>What are you looking for?</Text>
      <View style={styles.chipRow}>
        {GOALS.map((option) => (
          <Text
            key={option}
            onPress={() => setGoal(option)}
            style={[styles.chip, goal === option && styles.chipActive]}
          >
            {option.replace('_', ' ')}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>Interests</Text>
      <View style={styles.chipRow}>
        {(catalogue.data ?? []).map((interest) => (
          <Text
            key={interest.slug}
            onPress={() => toggleInterest(interest.slug)}
            style={[styles.chip, selectedInterests.includes(interest.slug) && styles.chipActive]}
          >
            {interest.emoji} {interest.labelEn}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>Photos</Text>
      <View style={styles.photoRow}>
        <Button label="Take photo" variant="secondary" onPress={() => upload.mutate(true)} />
        <Button label="Choose photo" variant="secondary" onPress={() => upload.mutate(false)} />
      </View>
      {upload.isPending ? <Text style={typography.caption}>Uploadingâ€¦</Text> : null}

      <Button label="Continue" onPress={() => void finish()} loading={update.isPending || saveInterests.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
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
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: 13,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary, color: '#fff' },
  photoRow: { flexDirection: 'row', gap: spacing.sm },
});
