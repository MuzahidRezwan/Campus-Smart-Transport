import { Linking, ScrollView, View } from 'react-native';
import { PROJECT_ABOUT } from '@diu/shared';
import { Button, Card, T, s, useTheme } from '../src/components/ui';

const initials = (name: string) => name.split(' ').map((p) => p[0]).join('').slice(0, 2);

/** What the app is and who built it. Open to everyone, signed in or not. */
export default function AboutScreen() {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card>
        <T bold size={20}>{PROJECT_ABOUT.name}</T>
        <T muted>{PROJECT_ABOUT.university}</T>
        <T>{PROJECT_ABOUT.summary}</T>
      </Card>
      <T bold>Created by</T>
      {PROJECT_ABOUT.creators.map((name) => (
        <Card key={name}>
          <View style={s.row}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <T bold color={t.accentInk}>{initials(name)}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T bold>{name}</T>
              <T muted size={12}>{PROJECT_ABOUT.department}</T>
            </View>
          </View>
        </Card>
      ))}
      <T muted size={12}>{PROJECT_ABOUT.department}, {PROJECT_ABOUT.university}.</T>
      <Button title="Source code on GitHub" onPress={() => { void Linking.openURL(PROJECT_ABOUT.repository); }} />
    </ScrollView>
  );
}
