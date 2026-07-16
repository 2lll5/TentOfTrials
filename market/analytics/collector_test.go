package analytics

import (
	"sync"
	"testing"
	"time"
)

func TestNewCollector_DefaultCardinality(t *testing.T) {
	c := NewCollector()
	stats := c.Stats()
	if stats.MaxCardinality != DefaultMaxCardinality {
		t.Errorf("expected default max cardinality %d, got %d", DefaultMaxCardinality, stats.MaxCardinality)
	}
}

func TestWithMaxCardinality(t *testing.T) {
	c := NewCollector().WithMaxCardinality(500)
	stats := c.Stats()
	if stats.MaxCardinality != 500 {
		t.Errorf("expected max cardinality 500, got %d", stats.MaxCardinality)
	}
}

func TestWithMaxCardinality_DisabledWhenZero(t *testing.T) {
	c := NewCollector().WithMaxCardinality(0)

	// Record many samples with different tag combinations
	for i := 0; i < 100; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i%26))},
				{Key: "instance", Value: string(rune(i))},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d should not be dropped when cardinality limiting is disabled", i)
		}
	}

	stats := c.Stats()
	if stats.Dropped != 0 {
		t.Errorf("expected 0 dropped, got %d", stats.Dropped)
	}
}

func TestRecord_AcceptedSamplesWithinLimit(t *testing.T) {
	c := NewCollector().WithMaxCardinality(5)

	// Record samples within the cardinality limit
	for i := 0; i < 5; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i))},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d should be accepted within cardinality limit", i)
		}
	}

	stats := c.Stats()
	if stats.Dropped != 0 {
		t.Errorf("expected 0 dropped, got %d", stats.Dropped)
	}
	if stats.BufferedSamples != 5 {
		t.Errorf("expected 5 buffered samples, got %d", stats.BufferedSamples)
	}
	if stats.TotalTagCombos != 5 {
		t.Errorf("expected 5 tag combos, got %d", stats.TotalTagCombos)
	}
}

func TestRecord_RejectedSamplesExceedingLimit(t *testing.T) {
	c := NewCollector().WithMaxCardinality(3)

	// Record 3 samples with unique tag combos
	for i := 0; i < 3; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i))},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d should be accepted", i)
		}
	}

	// 4th sample with a new tag combo should be dropped
	sample := MetricSample{
		Name:      "test_metric",
		Type:      MetricTypeCounter,
		Value:     1,
		Timestamp: time.Now(),
		Tags: []MetricTag{
			{Key: "host", Value: "host-d"},
		},
	}
	if c.Record(sample) {
		t.Fatal("sample should be dropped when exceeding cardinality limit")
	}

	stats := c.Stats()
	if stats.Dropped != 1 {
		t.Errorf("expected 1 dropped, got %d", stats.Dropped)
	}
	if stats.BufferedSamples != 3 {
		t.Errorf("expected 3 buffered samples, got %d", stats.BufferedSamples)
	}
	if stats.TotalTagCombos != 3 {
		t.Errorf("expected 3 tag combos, got %d", stats.TotalTagCombos)
	}
}

func TestRecord_DuplicateTagCombosAccepted(t *testing.T) {
	c := NewCollector().WithMaxCardinality(3)

	// Record the same tag combo multiple times
	for i := 0; i < 5; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-a"},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("duplicate sample %d should be accepted", i)
		}
	}

	stats := c.Stats()
	if stats.Dropped != 0 {
		t.Errorf("expected 0 dropped for duplicate tags, got %d", stats.Dropped)
	}
	if stats.TotalTagCombos != 1 {
		t.Errorf("expected 1 unique tag combo, got %d", stats.TotalTagCombos)
	}
}

func TestRecord_SeparateCardinalityPerMetric(t *testing.T) {
	c := NewCollector().WithMaxCardinality(2)

	// Record 2 unique combos for metric A
	for i := 0; i < 2; i++ {
		sample := MetricSample{
			Name:      "metric_a",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i))},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d for metric_a should be accepted", i)
		}
	}

	// Record 2 unique combos for metric B (should also be accepted)
	for i := 0; i < 2; i++ {
		sample := MetricSample{
			Name:      "metric_b",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i))},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d for metric_b should be accepted", i)
		}
	}

	stats := c.Stats()
	if stats.Dropped != 0 {
		t.Errorf("expected 0 dropped, got %d", stats.Dropped)
	}
	if stats.TotalTagCombos != 4 {
		t.Errorf("expected 4 total tag combos (2 per metric), got %d", stats.TotalTagCombos)
	}
}

func TestRecord_SamplesWithNoTagsAccepted(t *testing.T) {
	c := NewCollector().WithMaxCardinality(1)

	// Samples with no tags should always be accepted
	for i := 0; i < 10; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags:      nil,
		}
		if !c.Record(sample) {
			t.Fatalf("sample %d without tags should be accepted", i)
		}
	}

	stats := c.Stats()
	if stats.Dropped != 0 {
		t.Errorf("expected 0 dropped, got %d", stats.Dropped)
	}
}

func TestRecord_TagOrderDoesNotMatter(t *testing.T) {
	c := NewCollector().WithMaxCardinality(1)

	// Same tags in different order should be treated as the same combo
	sample1 := MetricSample{
		Name:      "test_metric",
		Type:      MetricTypeCounter,
		Value:     1,
		Timestamp: time.Now(),
		Tags: []MetricTag{
			{Key: "a", Value: "1"},
			{Key: "b", Value: "2"},
		},
	}
	sample2 := MetricSample{
		Name:      "test_metric",
		Type:      MetricTypeCounter,
		Value:     1,
		Timestamp: time.Now(),
		Tags: []MetricTag{
			{Key: "b", Value: "2"},
			{Key: "a", Value: "1"},
		},
	}

	if !c.Record(sample1) {
		t.Fatal("first sample should be accepted")
	}
	if !c.Record(sample2) {
		t.Fatal("second sample with same tags in different order should be accepted")
	}

	stats := c.Stats()
	if stats.TotalTagCombos != 1 {
		t.Errorf("expected 1 unique tag combo, got %d", stats.TotalTagCombos)
	}
}

func TestRecord_BacklogFullAndCardinalityFull(t *testing.T) {
	c := NewCollector().WithMaxBacklog(2).WithMaxCardinality(1)

	// Fill the backlog
	sample := MetricSample{
		Name:      "test_metric",
		Type:      MetricTypeCounter,
		Value:     1,
		Timestamp: time.Now(),
		Tags: []MetricTag{
			{Key: "host", Value: "host-a"},
		},
	}
	c.Record(sample)
	c.Record(sample)

	// New tag combo should be dropped due to cardinality
	sample2 := MetricSample{
		Name:      "test_metric",
		Type:      MetricTypeCounter,
		Value:     1,
		Timestamp: time.Now(),
		Tags: []MetricTag{
			{Key: "host", Value: "host-b"},
		},
	}
	if c.Record(sample2) {
		t.Fatal("sample should be dropped due to cardinality limit")
	}

	stats := c.Stats()
	if stats.Dropped != 1 {
		t.Errorf("expected 1 dropped (cardinality), got %d", stats.Dropped)
	}
}

func TestRecord_ConcurrentAccess(t *testing.T) {
	c := NewCollector().WithMaxCardinality(100)

	var wg sync.WaitGroup
	dropped := make(chan bool, 1000)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sample := MetricSample{
				Name:      "test_metric",
				Type:      MetricTypeCounter,
				Value:     1,
				Timestamp: time.Now(),
				Tags: []MetricTag{
					{Key: "host", Value: "host-" + string(rune('a'+i%26))},
					{Key: "instance", Value: string(rune(i))},
				},
			}
			result := c.Record(sample)
			dropped <- !result
		}(i)
	}

	wg.Wait()
	close(dropped)

	dropCount := 0
	for d := range dropped {
		if d {
			dropCount++
		}
	}

	stats := c.Stats()
	if int(stats.Dropped) != dropCount {
		t.Errorf("dropped count mismatch: stats=%d, manual=%d", stats.Dropped, dropCount)
	}
}

func TestTagKey(t *testing.T) {
	tests := []struct {
		name     string
		tags     []MetricTag
		expected string
	}{
		{
			name:     "empty tags",
			tags:     nil,
			expected: "",
		},
		{
			name:     "single tag",
			tags:     []MetricTag{{Key: "host", Value: "a"}},
			expected: "host\x00a",
		},
		{
			name:     "multiple tags sorted by key",
			tags:     []MetricTag{{Key: "b", Value: "2"}, {Key: "a", Value: "1"}},
			expected: "a\x001\x00b\x002",
		},
		{
			name:     "same tags different order",
			tags:     []MetricTag{{Key: "x", Value: "1"}, {Key: "a", Value: "2"}},
			expected: "a\x002\x00x\x001",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tagKey(tt.tags)
			if result != tt.expected {
				t.Errorf("tagKey() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestStats_IncludesCardinalityInfo(t *testing.T) {
	c := NewCollector().WithMaxCardinality(500)

	// Record some samples
	for i := 0; i < 3; i++ {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      MetricTypeCounter,
			Value:     1,
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "host", Value: "host-" + string(rune('a'+i))},
			},
		}
		c.Record(sample)
	}

	stats := c.Stats()
	if stats.MaxCardinality != 500 {
		t.Errorf("expected MaxCardinality 500, got %d", stats.MaxCardinality)
	}
	if stats.TotalTagCombos != 3 {
		t.Errorf("expected TotalTagCombos 3, got %d", stats.TotalTagCombos)
	}
}

func TestRecord_VariousMetricTypes(t *testing.T) {
	c := NewCollector().WithMaxCardinality(10)

	types := []MetricType{
		MetricTypeCounter,
		MetricTypeGauge,
		MetricTypeHistogram,
		MetricTypeTimer,
	}

	for i, mt := range types {
		sample := MetricSample{
			Name:      "test_metric",
			Type:      mt,
			Value:     float64(i),
			Timestamp: time.Now(),
			Tags: []MetricTag{
				{Key: "type", Value: mt.String()},
			},
		}
		if !c.Record(sample) {
			t.Fatalf("sample with type %v should be accepted", mt)
		}
	}

	stats := c.Stats()
	if stats.BufferedSamples != 4 {
		t.Errorf("expected 4 buffered samples, got %d", stats.BufferedSamples)
	}
}
