# Scenarios are written in plain English. Edit freely — no programming needed.
# The steps used here come from the reusable library in steps/common.steps.ts,
# so they work on any web app without extra code.
#
# Tag critical journeys @smoke (they also run on a phone-sized screen).

Feature: Basic health checks

  @smoke
  Scenario: The site loads
    Given I open the app
    Then the page loads successfully
    And the page has no obvious error
