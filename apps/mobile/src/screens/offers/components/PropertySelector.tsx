/**
 * PropertySelector — Fetches and displays offer-ready properties for selection.
 *
 * Used in Step 1 of the CreateOfferScreen multi-step form.
 * Fetches only properties that pass the offer-readiness check (has photos,
 * valid location, required fields, no active offer). Displays each property
 * as a card with cover photo, name, and city. Supports single selection
 * with visual accent highlight. Shows empty state with link to create property.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal property data needed for selector display */
export interface OfferReadyProperty {
  id: string;
  name: string;
  city: string;
  coverPhotoUrl: string | null;
}

export interface PropertySelectorProps {
  /** Callback when a property is selected */
  onSelect: (propertyId: string) => void;
  /** Currently selected property ID */
  selectedPropertyId?: string;
  /** Callback when "Create Property" link is pressed */
  onCreateProperty?: () => void;
}

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.1)',
  placeholder: '#2B3A4A',
  error: '#FF6B6B',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  title: 18,
  body: 14,
  caption: 12,
  link: 14,
} as const;

const CARD_PHOTO_SIZE = 64;
const BORDER_WIDTH_SELECTED = 2;

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Fetches offer-ready properties from the API.
 * Uses GET /properties?offerReady=true endpoint.
 * TODO(BID-30): Replace with actual API service call when available.
 */
async function fetchOfferReadyProperties(): Promise<OfferReadyProperty[]> {
  // Placeholder: replace with actual API integration
  // e.g., const response = await apiService.get('/properties?offerReady=true');
  // return response.data.items;
  return [];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PropertyCardProps {
  property: OfferReadyProperty;
  isSelected: boolean;
  onPress: (propertyId: string) => void;
}

function PropertyCard({ property, isSelected, onPress }: PropertyCardProps): React.JSX.Element {
  const handlePress = useCallback(() => {
    onPress(property.id);
  }, [onPress, property.id]);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && styles.cardSelected,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${property.name}, ${property.city}`}
      testID={`property-card-${property.id}`}
    >
      {property.coverPhotoUrl ? (
        <Image
          source={{ uri: property.coverPhotoUrl }}
          style={styles.photo}
          accessibilityLabel={property.name}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>{'📷'}</Text>
        </View>
      )}

      <View style={styles.cardContent}>
        <Text style={styles.propertyName} numberOfLines={1}>
          {property.name}
        </Text>
        <Text style={styles.propertyCity} numberOfLines={1}>
          {property.city}
        </Text>
      </View>

      {isSelected && (
        <View style={styles.checkmark} testID="property-selected-indicator">
          <Text style={styles.checkmarkText}>{'✓'}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Fetches offer-ready properties and displays them as selectable cards.
 *
 * @param props.onSelect - Called with property ID when user taps a card
 * @param props.selectedPropertyId - ID of currently selected property (highlights card)
 * @param props.onCreateProperty - Optional callback for "Create Property" link
 */
export function PropertySelector({
  onSelect,
  selectedPropertyId,
  onCreateProperty,
}: PropertySelectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const [properties, setProperties] = useState<OfferReadyProperty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProperties() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchOfferReadyProperties();
        if (isMounted) {
          setProperties(data);
        }
      } catch {
        if (isMounted) {
          setError(t('offers.propertySelector.error'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadProperties();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const handleSelect = useCallback(
    (propertyId: string) => {
      onSelect(propertyId);
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: { item: OfferReadyProperty }) => (
      <PropertyCard
        property={item}
        isSelected={item.id === selectedPropertyId}
        onPress={handleSelect}
      />
    ),
    [selectedPropertyId, handleSelect],
  );

  const keyExtractor = useCallback(
    (item: OfferReadyProperty) => item.id,
    [],
  );

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.centeredContainer} testID="property-selector-loading">
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>
          {t('offers.propertySelector.loading')}
        </Text>
      </View>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <View style={styles.centeredContainer} testID="property-selector-error">
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  // ─── Empty State ───────────────────────────────────────────────────────────

  if (properties.length === 0) {
    return (
      <View style={styles.centeredContainer} testID="property-selector-empty">
        <Text style={styles.emptyText}>
          {t('offers.propertySelector.empty')}
        </Text>
        {onCreateProperty && (
          <TouchableOpacity
            onPress={onCreateProperty}
            style={styles.createLink}
            accessibilityRole="link"
            testID="property-selector-create-link"
          >
            <Text style={styles.createLinkText}>
              {t('offers.propertySelector.createProperty')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ─── List State ────────────────────────────────────────────────────────────

  return (
    <View style={styles.container} testID="property-selector">
      <Text style={styles.title}>
        {t('offers.propertySelector.title')}
      </Text>
      <FlatList
        data={properties}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={ItemSeparator}
      />
    </View>
  );
}

// ─── Separator ───────────────────────────────────────────────────────────────

function ItemSeparator(): React.JSX.Element {
  return <View style={styles.separator} />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  listContent: {
    paddingBottom: SPACING.lg,
  },
  separator: {
    height: SPACING.sm,
  },
  // ─── Card ──────────────────────────────────────────────────────────────────
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: BORDER_WIDTH_SELECTED,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: COLORS.accent,
  },
  cardContent: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  propertyName: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  propertyCity: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  // ─── Photo ─────────────────────────────────────────────────────────────────
  photo: {
    width: CARD_PHOTO_SIZE,
    height: CARD_PHOTO_SIZE,
    borderRadius: 8,
  },
  photoPlaceholder: {
    width: CARD_PHOTO_SIZE,
    height: CARD_PHOTO_SIZE,
    borderRadius: 8,
    backgroundColor: COLORS.placeholder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    fontSize: 24,
  },
  // ─── Selection Indicator ───────────────────────────────────────────────────
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: SPACING.sm,
  },
  checkmarkText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.background,
  },
  // ─── Empty State ───────────────────────────────────────────────────────────
  emptyText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  createLink: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  createLinkText: {
    fontSize: FONT_SIZE.link,
    fontWeight: '600',
    color: COLORS.accent,
    textDecorationLine: 'underline',
  },
  // ─── Loading State ─────────────────────────────────────────────────────────
  loadingText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  // ─── Error State ───────────────────────────────────────────────────────────
  errorText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.error,
    textAlign: 'center',
  },
});

export default PropertySelector;
