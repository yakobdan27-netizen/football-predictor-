# Core database ERD (additive layer)

Legacy `hist_*` / `live_*` / `bet_*` / KV batches remain authoritative. This diagram covers new `core_*` / `analytics_*` / `audit_*` objects only.

```mermaid
erDiagram
  core_competition ||--o{ core_season : has
  core_competition ||--o{ core_fixture : hosts
  core_season ||--o{ core_fixture : contains
  core_team ||--o{ core_team_alias : named
  core_team ||--o{ core_fixture : home_or_away
  core_fixture ||--o{ core_fixture_statistic : facts
  core_fixture ||--o{ core_legacy_record_map : mapped_from
  core_fixture ||--o{ core_result_trace : optional
  core_competition ||--o{ core_coverage_audit : audited
  core_season ||--o{ core_coverage_audit : audited
  core_prediction_run ||--o{ core_market_probability : emits
  core_fixture ||--o{ core_market_probability : scores

  core_competition {
    int id PK
    text provider_name
    int provider_competition_id
    text name
    text comp_type
  }

  core_season {
    int id PK
    int competition_id FK
    int provider_season
    text label
  }

  core_team {
    int id PK
    int provider_team_id
    text canonical_name
  }

  core_team_alias {
    int id PK
    int team_id FK
    text alias_normalized
    int approved
  }

  core_fixture {
    int id PK
    int provider_fixture_id
    int competition_id FK
    int season_id FK
    text home_team_name
    text away_team_name
    int ft_home
    int ft_away
    int manual_verified
  }

  core_fixture_statistic {
    int id PK
    int fixture_id FK
    text side
    text stat_key
    int stat_value "NULL means missing"
  }

  core_legacy_record_map {
    int id PK
    text legacy_source_table
    text legacy_pk
    text canonical_entity_type
    int canonical_entity_id
  }

  core_result_trace {
    int id PK
    text batch_id
    text match_id
    text status
    int provider_fixture_id
  }

  core_coverage_audit {
    int id PK
    int competition_id FK
    int season_id FK
    int expected_fixtures
    int imported_fixtures
  }

  audit_data_change_log {
    int id PK
    text entity_type
    int entity_id
    text action
  }
```

View `analytics_v_fixture_compat` projects `core_fixture` + home/away corner stats for shadow compares. It never replaces a legacy table.
